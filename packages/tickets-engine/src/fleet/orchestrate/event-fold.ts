import { parseFollowups } from '../../core/followups';
import type { RunInfo } from '../protocol';
import { MEMORY_WRITE_TOOL } from '../protocol-closing';
import type { NormalizedEvent } from '../harness/contract';
import { frictionOf, sendBackOf } from '../harness/event-text';
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

/**
 * The `followups` a `result` event settles on the record (req-299): what the
 * final message proposed, and — only when an earlier turn had proposed some —
 * an empty list when a later message proposes none, so a steered run does not
 * keep stale proposals. Nothing for every other event and for a run that
 * never proposed (`run.json` stays byte-identical).
 */
function followupsPatch(info: RunInfo, event: NormalizedEvent): Pick<RunInfo, 'followups'> | Record<string, never> {
  if (event.kind !== 'result') {
    return {};
  }
  const drafts = parseFollowups(event.text ?? '');
  if (drafts.length > 0) {
    return { followups: drafts };
  }
  return (info.followups ?? []).length > 0 ? { followups: [] } : {};
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
    ...followupsPatch(info, event),
    usage: telemetry.usage,
    lastTurnContext: telemetry.lastTurnContext,
    turns: telemetry.turns,
    readCalls: telemetry.readCalls,
    tokensBeforeFirstWrite: telemetry.tokensBeforeFirstWrite,
    ...(event.kind === 'error' ? { lastError: event.text ?? 'error' } : {}),
  };
  return foldExecSpan(info, next, event.ts);
}

/** The vault MCP's audit of a `memory_write` that went through (req-226): the run saved its lesson. */
function isLessonSaved(event: NormalizedEvent): boolean {
  return event.kind === 'tool' && event.detail === 'audit' && event.audit?.verdict === 'allowed' && (event.tool ?? '').endsWith(`__${MEMORY_WRITE_TOOL}`);
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
      run.friction = frictionOf(event.text ?? ''); // req-169: the closing round's `friction` signal
      run.sendBack = run.request.cursor !== undefined ? sendBackOf(event.text ?? '') : null; // req-257: a chain run's verdict
    }
    if (isLessonSaved(event)) {
      run.lessonWritten = true;
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
