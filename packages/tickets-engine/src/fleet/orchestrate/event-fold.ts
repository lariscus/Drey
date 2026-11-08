import type { RunInfo } from '../protocol';
import type { NormalizedEvent } from '../harness/contract';
import { foldExecSpan } from '../run/exec-span';
import type { RunTelemetry } from '../telemetry';
import type { BackgroundWork } from './background-work';
import { messageOf, type LiveRun } from './live-run';
import type { RunBookkeeper } from './run-bookkeeper';
import type { RunRepository } from './run-repository';
import type { RunStreams } from './run-streams';

/** The event fields that land on the record as they are, when the event carries them. */
const COPIED = ['contextTokens', 'contextWindow', 'turn', 'commands', 'tokensIn', 'tokensOut', 'cacheReadTokens', 'costUsd', 'blocked'] as const;

function copiedFields(event: NormalizedEvent): Partial<RunInfo> {
  const out: Record<string, unknown> = {};
  for (const key of COPIED) {
    if (event[key] !== undefined) {
      out[key] = event[key];
    }
  }
  return out as Partial<RunInfo>;
}

/** The record after one event: activity, the copied fields, the wait, the telemetry, the busy clock. */
export function foldEvent(info: RunInfo, event: NormalizedEvent, telemetry: RunTelemetry): RunInfo {
  const next: RunInfo = {
    ...info,
    lastActivity: event.ts,
    ...(info.stuck === true ? { stuck: false } : {}),
    ...(event.activity !== undefined && event.activity !== '' ? { activity: event.activity } : {}),
    ...copiedFields(event),
    ...(event.waiting !== undefined ? { waiting: event.waiting === null ? null : { ...event.waiting, since: event.ts } } : {}),
    usage: telemetry.usage,
    lastTurnContext: telemetry.lastTurnContext,
    turns: telemetry.turns,
    readCalls: telemetry.readCalls,
    tokensBeforeFirstWrite: telemetry.tokensBeforeFirstWrite,
    ...(event.kind === 'error' ? { lastError: event.text ?? 'error' } : {}),
  };
  return foldExecSpan(info, next, event.ts);
}

/** An event that closes one tool call — the safe point to pause at. */
function isActionBoundary(event: NormalizedEvent): boolean {
  return (event.kind === 'note' && (event.text ?? '').startsWith('result › ')) || (event.kind === 'tool' && (event.detail === 'done' || event.detail === 'failed'));
}

export interface EventFoldDeps {
  readonly repo: RunRepository;
  readonly streams: RunStreams;
  readonly bookkeeper: RunBookkeeper;
  readonly background: BackgroundWork;
  readonly log: (message: string) => void;
  /** "Pause after the current action": the action finished, interrupt the turn now. */
  readonly interrupt: (run: LiveRun) => Promise<unknown>;
  /** A wait ended without our answer path and the ticket could not be re-claimed. */
  readonly claimLost: (run: LiveRun, why: string) => Promise<void>;
}

/**
 * The worker's events, folded into the run (ADR-0075): the synchronous
 * prefix sets what the exit must already see (agent-done, the soft pause,
 * the telemetry), the rest queues per run — stream append, record fold,
 * persist, the wait's bookkeeping — strictly in arrival order.
 */
export class EventFold {
  constructor(private readonly deps: EventFoldDeps) {}

  onEvent(run: LiveRun, event: NormalizedEvent): void {
    // The worker's exit can race the event delivery: `agentDone` must already be true when the exit decides.
    if (event.kind === 'result' && run.paused !== true) {
      run.agentDone = true;
      run.blocked = event.blocked ?? null;
    }
    if (run.softPause === true && isActionBoundary(event)) {
      run.softPause = false; // the action the owner waited for has finished: pause now
      this.deps.background.track(this.deps.interrupt(run).catch(() => undefined));
    }
    if (event.kind === 'result') {
      run.softPause = false; // the turn ended by itself — nothing left to pause
    }
    run.telemetry.apply(event);
    run.eventQueue = run.eventQueue
      .then(() => this.apply(run, event))
      .catch((error) => this.deps.log(`run ${run.info.id}: folding an event failed — ${messageOf(error)}`));
    this.deps.background.track(run.eventQueue);
  }

  /** The queued half of an event: stream append, fold, record — one at a time. */
  private async apply(run: LiveRun, event: NormalizedEvent): Promise<void> {
    await this.deps.streams.append(run, event);
    run.info = foldEvent(run.info, event, run.telemetry.get());
    if (event.kind === 'error') {
      this.deps.log(`run ${run.info.id}: ${event.text ?? 'error'}`);
    }
    await this.deps.repo.persist(run);
    if (event.waiting !== undefined && event.waiting !== null) {
      // The question stays in the run's transcript — the owner may answer from the board later.
      const what = event.waiting.kind === 'question' ? 'asks the owner' : 'waits for approval';
      this.deps.log(`run ${run.info.id} (${run.info.ticketId}) ${what}: ${event.waiting.text.slice(0, 200)}`);
      await this.deps.bookkeeper.note(run, `${what} — ${event.waiting.text.slice(0, 400)}`);
      await this.deps.bookkeeper.releaseForWait(run, `${what}: ${event.waiting.text}`);
    } else if (event.waiting === null && run.waitReleased === true) {
      // The wait ended without our answer path (the owner answered in the worker's own UI): take the ticket up again.
      const outcome = await this.deps.bookkeeper.reclaimAfterWait(run, null);
      if (!outcome.ok) {
        this.deps.background.track(this.deps.claimLost(run, outcome.error));
      }
    }
  }
}
