import type { RunInfo, RunRequest } from '../protocol';
import type { WorkerHandle } from '../providers';
import type { RunLease } from '../run-lease';
import type { RunHandover, StoredRun, UsageBase } from '../run/run-record';
import { TelemetryFold, type RunTelemetry } from '../telemetry';

/**
 * One run as the supervisor holds it while the runner lives: the record
 * (`info`, changed through the state machine and the event fold), its
 * request, the worker handle and the run's own queues and flags. The
 * persisted half is {@link StoredRun}; everything else dies with the runner.
 */
export interface LiveRun {
  info: RunInfo;
  readonly request: RunRequest;
  /** The stage the ticket sits in NOW — a success move changes it. */
  currentPhase: string;
  readonly dir: string;
  handle: WorkerHandle | null;
  readonly startedAtMs: number;
  /** The worker exited and the machine gate is deciding — the reaper stands down. */
  gating: boolean;
  /** The second-opinion round ran (the move follows its own gate). */
  audited: boolean;
  /** The worker finished its turn — the adapter's `result` event, the agent-done signal. */
  agentDone: boolean;
  /** Why the worker declared the step incomplete (`BLOCKED:`), set with `agentDone`; the exit decides from it. */
  blocked?: string | null;
  /** The owner interrupted the turn: the `result` that follows is the interrupt's, not a completion. */
  paused?: boolean;
  /** The owner asked for a pause after the current action (`pauseAfterAction`). */
  softPause?: boolean;
  /** Folds the run's token telemetry (T-0048) out of every stream event. */
  readonly telemetry: TelemetryFold;
  /** Why the run was stopped — becomes the release note when the run ends. */
  stopNote?: string;
  /** An ended run's session the owner reopened: held from the start, no gate and no move at its end. */
  readonly reopened?: boolean;
  /** The runner is retiring and left this run to its successor: its worker's exit decides nothing here. */
  handover?: RunHandover;
  /** The resumed session's spend before this run, once the adapter read it (req-53). */
  usageBase?: UsageBase;
  /** A failed resume is being replaced by a fresh worker under the same id (T-0049): the dying worker decides nothing. */
  fallbackActive?: boolean;
  /** The async half of the event fold, strictly in arrival order (the req-67 clock-freeze flake). */
  eventQueue: Promise<void>;
  /** The record writes, in call order: an older snapshot never lands after a newer one. */
  writeQueue: Promise<void>;
  /** The in-flight "looks stuck" note + persist; the settle and the end of a reap wait for it. */
  stuckLog?: Promise<void>;
  /** The run's one settle, once begun. */
  settling?: Promise<void>;
  /** E14-5: the run's claim on its dricket ticket. */
  lease?: RunLease;
  /** E14-5b (Q-03): the claim was given up while the worker waits for the owner; the answer re-claims. */
  waitReleased?: boolean;
  /** The decision key of the open wait (`needs-decision` / `resolved`). */
  waitKey?: string;
  /** The Verlauf line went into the ticket inside the claim — written once. */
  verlaufWritten?: boolean;
  /** Why the lease was lost (exit 13): the worker was stopped and the ticket is not ours to write. */
  claimLost?: string;
}

/** What a new live run starts from; every flag and queue gets its resting value. */
export interface LiveRunSeed {
  readonly info: RunInfo;
  readonly request: RunRequest;
  readonly dir: string;
  readonly startedAtMs?: number;
  readonly usageBase?: UsageBase;
  readonly reopened?: boolean;
  readonly lease?: RunLease;
  /** A fresh run starts its fold empty; an adopted one restores it from the record. */
  readonly freshTelemetry?: boolean;
}

export function newLiveRun(seed: LiveRunSeed): LiveRun {
  return {
    info: seed.info,
    request: seed.request,
    currentPhase: seed.request.phase,
    dir: seed.dir,
    handle: null,
    startedAtMs: seed.startedAtMs ?? Date.parse(seed.info.startedAt),
    gating: false,
    audited: false,
    agentDone: false,
    telemetry: new TelemetryFold(seed.freshTelemetry === true ? undefined : telemetryOf(seed.info)),
    eventQueue: Promise.resolve(),
    writeQueue: Promise.resolve(),
    ...(seed.freshTelemetry === true ? { blocked: null } : {}),
    ...(seed.usageBase !== undefined ? { usageBase: seed.usageBase } : {}),
    ...(seed.reopened === true ? { reopened: true } : {}),
    ...(seed.lease !== undefined ? { lease: seed.lease } : {}),
  };
}

/** The telemetry a persisted record carries, for restoring a fold (an adopted run). */
export function telemetryOf(info: RunInfo): RunTelemetry | undefined {
  if (
    info.usage === undefined &&
    info.turns === undefined &&
    info.readCalls === undefined &&
    info.lastTurnContext === undefined &&
    info.tokensBeforeFirstWrite === undefined
  ) {
    return undefined;
  }
  return {
    usage: info.usage ?? { input: null, cacheRead: null, cacheCreation: null, output: null },
    lastTurnContext: info.lastTurnContext ?? null,
    turns: info.turns ?? 0,
    readCalls: info.readCalls ?? 0,
    tokensBeforeFirstWrite: info.tokensBeforeFirstWrite ?? null,
  };
}

/** The persisted half of a live run. */
export function storedOf(run: LiveRun): StoredRun {
  return {
    request: run.request,
    info: run.info,
    ...(run.handover !== undefined ? { handover: run.handover } : {}),
    ...(run.usageBase !== undefined ? { usageBase: run.usageBase } : {}),
  };
}

/** The recorded pid, else the handle's once its server booted. */
export function currentPid(run: LiveRun): number | null {
  const handlePid = run.handle === null ? null : run.handle.pid;
  return run.info.pid ?? (handlePid !== null && handlePid > 0 ? handlePid : null);
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
