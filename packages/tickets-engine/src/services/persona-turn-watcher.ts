import type { RunInfo } from '../fleet/protocol';

/** What a 1:1 turn ended with: the persona's answer, or why none came. */
export type TurnOutcome = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string };

/** The stream lead-in the steer path writes for the owner's prompt (`steer-service.ts`). */
const OWNER_PROMPT = 'you › ';

interface StreamLine {
  readonly kind?: string;
  readonly text?: string;
}

/**
 * The answer to the owner's LAST prompt in a run's stream: the `text`
 * events after the last `you › …` note, and whether the turn has ended (a
 * `result` after it). Pure — the stream's file text in, nothing else.
 */
export function answerAfterLastPrompt(stream: string): { readonly done: boolean; readonly text: string } {
  const events: StreamLine[] = [];
  for (const line of stream.split('\n')) {
    try {
      events.push(JSON.parse(line) as StreamLine);
    } catch {
      // a torn last line: the next read has it whole
    }
  }
  let promptAt = -1;
  events.forEach((e, index) => {
    if (e.kind === 'note' && typeof e.text === 'string' && e.text.startsWith(OWNER_PROMPT)) {
      promptAt = index;
    }
  });
  const after = promptAt < 0 ? [] : events.slice(promptAt + 1);
  const text = after
    .filter((e) => e.kind === 'text' && typeof e.text === 'string')
    .map((e) => e.text!.trim())
    .filter((t) => t !== '')
    .join('\n\n');
  return { done: after.some((e) => e.kind === 'result'), text };
}

/** The runner as the watcher reads it. */
export interface TurnSource {
  runs(): Promise<readonly RunInfo[]>;
  stream(runId: string): Promise<string | null>;
}

/** Fires on every change of the fleet's state; returns the unsubscribe. */
export type FleetChanges = (listener: () => void) => () => void;

const ENDED: readonly string[] = ['done', 'stopped', 'failed'];

/**
 * Waits for a 1:1 turn to end (req-168): on every fleet change — the
 * runner's record changes when a turn ends — it reads the run's stream
 * and resolves with the persona's answer once a `result` follows the
 * owner's prompt; a session that ends first resolves with what it said, or
 * with why nothing came. No clock: the fleet's change push is the signal.
 */
export class PersonaTurnWatcher {
  constructor(
    private readonly source: TurnSource,
    private readonly changes: FleetChanges,
  ) {}

  wait(runId: string): Promise<TurnOutcome> {
    return new Promise<TurnOutcome>((resolve) => {
      let settled = false;
      let checking = false;
      const finish = (outcome: TurnOutcome): void => {
        if (!settled) {
          settled = true;
          unsubscribe();
          resolve(outcome);
        }
      };
      const check = (): void => {
        if (settled || checking) {
          return;
        }
        checking = true;
        void this.look(runId).then(
          (outcome) => {
            checking = false;
            if (outcome !== null) {
              finish(outcome);
            }
          },
          (error: unknown) => finish({ ok: false, error: error instanceof Error ? error.message : String(error) }),
        );
      };
      const unsubscribe = this.changes(check);
      check();
    });
  }

  /** The outcome once the turn is over; null while it runs. */
  private async look(runId: string): Promise<TurnOutcome | null> {
    const answer = answerAfterLastPrompt((await this.source.stream(runId)) ?? '');
    if (answer.done) {
      return answer.text === '' ? { ok: false, error: 'the persona ended its turn without an answer' } : { ok: true, text: answer.text };
    }
    const run = (await this.source.runs()).find((r) => r.id === runId);
    if (run === undefined || ENDED.includes(run.state)) {
      return answer.text !== '' ? { ok: true, text: answer.text } : { ok: false, error: run?.lastError ?? 'the session ended before it answered' };
    }
    return null;
  }
}
