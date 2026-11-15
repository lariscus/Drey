import type { SteerRung } from '../protocol';
import { answersFromText } from '../harness/question-forms';
import type { StopOutcome, TakeoverOutcome } from './run-record';
import { isTerminal } from './run-state';
import type { LiveRun } from './live-run';
import type { OwnerAnswers } from './owner-answers';
import type { RunBookkeeper } from './run-bookkeeper';
import type { RunReopener } from './run-reopener';
import type { RunRepository } from './run-repository';
import type { RunStreams } from './run-streams';

/** What a paused worker is told when the owner hands the run back. */
export const HANDBACK_CONTINUE =
  'The owner hands the run back after a pause. Continue the step from where you stopped — do not start over; ' +
  'what is committed or written down stands. Finish it as usual: gate commands green, the handover written.';

/** Why a live run takes no prompt, or null. */
function unsteerable(run: LiveRun): string | null {
  if (run.info.state !== 'running' && run.info.state !== 'starting') {
    return `run ${run.info.id} is ${run.info.state} — nothing to steer`;
  }
  return run.handle === null ? `run ${run.info.id} has no worker attached to steer` : null;
}

export type SendOutcome = StopOutcome & { rung?: SteerRung; runId?: string };

/**
 * The owner at the wheel (ADR-0075, req-64/65/75): a prompt (the first one
 * takes the run over; an ended run reopens), the interrupt, the pause
 * after the current action, and handing the run back. The takeover, the
 * hold and the release live in {@link RunTakeover}.
 */
export class SteerService {
  constructor(
    private readonly repo: RunRepository,
    private readonly bookkeeper: RunBookkeeper,
    private readonly owner: { readonly answers: OwnerAnswers; readonly reopener: RunReopener; readonly hold: (run: LiveRun, why: string) => Promise<void> },
    private readonly streams: RunStreams,
  ) {}

  async send(runId: string, text: string): Promise<SendOutcome> {
    const run = this.repo.find(runId);
    if (run === undefined) {
      return { ok: false, error: `unknown run "${runId}"` };
    }
    if (isTerminal(run.info.state)) {
      return this.reopenWith(run, text);
    }
    const refusal = unsteerable(run);
    if (refusal !== null) {
      return { ok: false, error: refusal };
    }
    // An answer to the worker's own question is not a takeover (req-64): its next finished turn ends the run as usual.
    const answersQuestion = run.info.waiting?.kind === 'question';
    const form = run.info.waiting?.questions;
    if (answersQuestion && form !== undefined && run.handle?.answerQuestion !== undefined) {
      return this.owner.answers.answerQuestion(runId, answersFromText(form, text));
    }
    if (!answersQuestion) {
      await this.owner.hold(run, 'first prompt');
      run.paused = false; // the owner's own message starts a turn whose result counts
      if (run.info.paused === true) {
        run.info = { ...run.info, paused: false };
      }
    }
    return this.deliver(run, text, answersQuestion);
  }

  /** Every run takes a prompt: an ended one reopens its session under a new run the owner holds. */
  private async reopenWith(run: LiveRun, text: string): Promise<SendOutcome> {
    if (text.trim() === '') {
      return { ok: false, error: `run ${run.info.id} has ended — type a message to reopen it` };
    }
    const reopened = await this.owner.reopener.reopen(run, text);
    if (!reopened.ok) {
      return reopened;
    }
    const fresh = this.repo.find(reopened.run.id);
    if (fresh !== undefined) {
      await this.streams.say(fresh, `you › ${text}`);
    }
    return { ok: true, rung: 'resume', runId: reopened.run.id };
  }

  /**
   * A quiet start (req-75) delivered no brief at spawn: the composed
   * instruction rides the owner's FIRST message, once — guarded on
   * `quietStart`, never on the steer count.
   */
  private async deliver(run: LiveRun, text: string, answersQuestion: boolean): Promise<SendOutcome> {
    const quiet = run.info.quietStart === true;
    const outgoing = quiet ? `${run.request.instruction}\n\n---\n\nThe owner starts the dialog:\n${text}` : text;
    await this.streams.say(run, `you › ${text}`);
    const rung = await run.handle!.steer(outgoing);
    run.info = { ...run.info, steerCount: run.info.steerCount + 1, lastSteerRung: rung, ...(quiet ? { quietStart: undefined } : {}) };
    await this.repo.persist(run);
    await this.bookkeeper.note(run, `${answersQuestion ? 'answered by the owner' : `steer (${rung})`}: ${text.slice(0, 200)}`);
    if (rung === 'refused') {
      return { ok: false, error: `the ${run.info.provider} worker took no message — it may have ended` };
    }
    return { ok: true, rung };
  }
}
