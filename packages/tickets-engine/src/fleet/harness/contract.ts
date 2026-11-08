/**
 * The harness contract (ADR-0075, ADR-0096): what every coding-agent adapter
 * — Claude Code, OpenCode, Kimi — gives the runner. A worker is started
 * from a `ProviderStart`, reports `NormalizedEvent`s, and is driven through
 * one `WorkerHandle`. Optional capabilities are optional methods, never
 * flags. Types only: no Node, no adapter, nothing of the orchestration.
 */
import type { PermissionDecision, PermissionMode, QuestionAnswers, RunUsage, RunWaiting, SteerRung, WorkerProviderId } from '../protocol';

/** One quota window as the provider reports it (req-177 consumes it). */
export interface RateLimitWindow {
  /** The share spent, 0–1. */
  readonly utilization: number | null;
  /** When the window resets (ISO), when the provider says. */
  readonly resetsAt: string | null;
  readonly status: 'allowed' | 'allowed_warning' | 'rejected' | null;
}

/** The provider's quota reading after a turn: the rolling five hours and the week. */
export interface RateLimitReading {
  readonly fiveHour: RateLimitWindow | null;
  readonly sevenDay: RateLimitWindow | null;
}

/** One line of the run's normalized stream file (`stream.jsonl`). */
export interface NormalizedEvent {
  readonly ts: string;
  readonly kind: 'note' | 'text' | 'usage' | 'result' | 'error' | 'tool' | 'text-delta';
  readonly text?: string;
  /** The tool's name — on `tool` events the called tool, on a tool-call note the name the telemetry counts. */
  readonly tool?: string;
  /** `text-delta`: `'end'` seals the part (its `text` is the WHOLE part). `tool`: `'running'` | `'done'` | `'failed'`. */
  readonly detail?: string;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  /** The part of `tokensIn` the provider served from its prompt cache. */
  readonly cacheReadTokens?: number;
  readonly costUsd?: number;
  /** One short line: what the worker is doing now. */
  readonly activity?: string;
  /** On an edit/write tool-call note: the lines it adds and removes. */
  readonly changes?: { readonly added: number; readonly removed: number };
  /** The current context window's size in tokens. */
  readonly contextTokens?: number;
  /** The model's context window in tokens (its limit), reported once when known. */
  readonly contextWindow?: number;
  /** The worker's turn state, when it changed: mid-turn or standing. */
  readonly turn?: 'busy' | 'idle';
  /** The slash commands the worker accepts (names without the slash). */
  readonly commands?: readonly string[];
  /** The worker began (or stopped) waiting on the owner (req-64); `since` is the event's `ts`. */
  readonly waiting?: Omit<RunWaiting, 'since'> | null;
  /** On a `result` event: why the worker declared the step incomplete (`BLOCKED:`); null/absent when it completes. */
  readonly blocked?: string | null;
  /** Exactly one per assistant model call: THAT call's usage (the aggregates are cumulative, never a turn's context). */
  readonly turnUsage?: RunUsage;
  /** On a `usage` event: the provider's quota windows after the turn (Claude Code's `rate_limit_event`). */
  readonly rateLimit?: RateLimitReading;
}

/** A session's cumulative usage (OpenCode keeps it per session, across runs). */
export interface UsageTotals {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly cacheReadTokens: number;
  readonly costUsd: number | null;
}

export const ZERO_USAGE: UsageTotals = { tokensIn: 0, tokensOut: 0, cacheReadTokens: 0, costUsd: null };

/** The session's totals as this run's own: minus the base, never below zero. */
export function usageSince(total: UsageTotals, base: UsageTotals): UsageTotals {
  return {
    tokensIn: Math.max(0, total.tokensIn - base.tokensIn),
    tokensOut: Math.max(0, total.tokensOut - base.tokensOut),
    cacheReadTokens: Math.max(0, total.cacheReadTokens - base.cacheReadTokens),
    costUsd: total.costUsd === null ? null : Math.max(0, total.costUsd - (base.costUsd ?? 0)),
  };
}

/** What a booted server reports for a later take-back. */
export interface ServerInfo {
  readonly address: string;
  readonly password: string;
  readonly pid: number | null;
}

export interface ProviderStart {
  readonly cwd: string;
  readonly instruction: string;
  readonly model: string | null;
  readonly permissionMode: PermissionMode;
  /** A previous run's session — the adapter resumes it when it can. */
  readonly resumeRef: string | null;
  /** Compact the resumed session before the first prompt (T-0049); only with a `resumeRef`. */
  readonly compactFirst?: boolean;
  /** The context window the worker compacts at (req-80); OpenCode only. */
  readonly contextCap?: number;
  /** The resume could not be established — at most once, before the first prompt; the supervisor respawns fresh. */
  readonly onResumeFailed?: (reason: string) => void;
  /** Deliver NO first prompt — a quiet start (req-75); claude-code ignores it. */
  readonly holdAtSpawn?: boolean;
  readonly ticketId: string;
  /** Events land here; the run's stream file keeps them. */
  readonly onEvent: (event: NormalizedEvent) => void;
  /** The session to steer/resume with, as soon as the provider reports it. */
  readonly onSessionRef: (ref: string) => void;
  /** What a later runner needs to re-attach (the server's address and per-boot credential). */
  readonly onAttachInfo?: (info: ServerInfo) => void;
  /** What the resumed session had already spent before this run (req-53); absent on a resume = read it first. */
  readonly usageBase?: UsageTotals;
  readonly onUsageBase?: (base: UsageTotals) => void;
}

/** What re-attaching to a worker that outlived its runner takes (OpenCode). */
export interface AttachInfo {
  readonly address: string;
  readonly password: string;
  readonly sessionRef: string;
  /** Epoch ms of the run's start: an idle marker before it belongs to an earlier turn. */
  readonly runStartedMs: number;
  /** Messages completed at or before this instant are already in the run's stream. */
  readonly seenBeforeMs: number;
  readonly pid: number | null;
  /** Kills the worker's process tree — the adapter holds no process handle of an attached worker. */
  kill(): Promise<void>;
}

export interface WorkerHandle {
  readonly pid: number | null;
  /** Resolves with the worker's exit code (null on signal/kill). */
  readonly exited: Promise<number | null>;
  /** Best available steer rung for this provider. */
  steer(text: string): Promise<SteerRung>;
  /** Hard stop: provider soft-abort first, then the tree-kill. */
  stop(): Promise<void>;
  /** Human takeover: while held a finished turn is not the run's end. */
  setHold?(held: boolean): void;
  /** The soft stop of the current turn — session and process stay. False when nothing is to interrupt. */
  interrupt?(): Promise<boolean>;
  /** Answers the pending permission request (req-64). False when it is gone or refused. */
  answerPermission?(requestId: string, decision: PermissionDecision): Promise<boolean>;
  /** Answers the pending question form: the worker's tool call returns the answers. */
  answerQuestion?(formId: string, answers: QuestionAnswers): Promise<boolean>;
}

export interface ProviderAdapter {
  readonly id: WorkerProviderId;
  readonly label: string;
  /** True when steer reaches a live worker without ending it. */
  readonly liveInject: boolean;
  /** True when a resumed session can stand without a first prompt (req-80; OpenCode's server). */
  readonly promptless?: boolean;
  spawn(start: ProviderStart): WorkerHandle;
  /** A handle on a worker that outlived its runner (absent when the provider cannot). */
  attach?(start: ProviderStart, info: AttachInfo): WorkerHandle;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
export type NowFn = () => Date;
