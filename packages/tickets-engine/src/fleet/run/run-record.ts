import type { RunInfo, RunRequest } from '../protocol';

/** A provider session's spend before this run (req-53) — a resumed session keeps subtracting it. */
export interface UsageBase {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly cacheReadTokens: number;
  readonly costUsd: number | null;
}

/**
 * How a retiring runner left a live run for its successor (req-51):
 * `reattach` — the worker lives on and the successor binds to it
 * (OpenCode's server); `resume` — the worker was stopped (its pipes die
 * with the runner, Claude Code) and the successor resumes the provider
 * session in place, under the same run id. `pidStartedMs` is the worker's
 * creation time, the pid-reuse guard of the successor's kill.
 */
export interface RunHandover {
  readonly mode: 'reattach' | 'resume';
  readonly at: string;
  readonly pidStartedMs: number | null;
  /** The worker stood idle at the handover — nothing was cut short (req-80; absent on older records). */
  readonly turnIdle?: boolean;
}

/** `runs/<id>/run.json`: what a restart's adoption reads back. */
export interface StoredRun {
  readonly request: RunRequest;
  readonly info: RunInfo;
  /** Set by a runner that retired for a newer build without stopping the run (req-51). */
  readonly handover?: RunHandover;
  /** A resumed session's spend before this run (req-53). */
  readonly usageBase?: UsageBase;
}

/** One run as the supervisor holds it: the record plus its request (the orchestrator counts pool slots by it). */
export interface SupervisorRecord {
  readonly info: RunInfo;
  readonly request: RunRequest;
}

export type StartOutcome = { readonly ok: true; readonly run: RunInfo } | { readonly ok: false; readonly error: string };

/** What a stop, a takeover or an answer call answers. */
export type StopOutcome = { readonly ok: true } | { readonly ok: false; readonly error: string };

export type TakeoverOutcome = StopOutcome;
