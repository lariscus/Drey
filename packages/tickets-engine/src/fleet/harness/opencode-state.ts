import { ZERO_USAGE, type AttachInfo, type NormalizedEvent, type NowFn, type ProviderStart, type UsageTotals } from './contract';
import type { OpencodeClient } from './opencode-client';

/** One OpenCode worker's mutable state, shared by its parts (boot, poll, events, handle). */
export interface OpencodeState {
  sessionRef: string | null;
  alive: boolean;
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  costUsd: number | null;
  /** The resumed session's earlier spend; null until a resume has read it. */
  usageBase: UsageTotals | null;
  startedAt: number;
  turnDone: boolean;
  /** A human drives the session: an idle marker is not the run's end. */
  held: boolean;
  /** The turn ended with a question to the owner (req-64): stand until answered. */
  questionHold: boolean;
  /** The prompt time whose question was already reported (one report per turn). */
  questionReportedFor: number;
  /** The permission request now reported as the wait, or null. */
  permissionId: string | null;
  /** The question form now reported as the wait, or null. */
  formId: string | null;
  turn: 'busy' | 'idle' | undefined;
  /** Idle markers older than this belong to an earlier turn. */
  lastPromptAt: number;
  ended: boolean;
  readonly seenAssistant: Set<string>;
  readonly seenTools: Set<string>;
  /** Messages settled at or before this instant are history, never re-emitted (attach and resume). */
  seenBeforeMs: number | null;
  lastText: string;
  contextTokens: number;
}

export function newOpencodeState(start: ProviderStart, attached: AttachInfo | null): OpencodeState {
  return {
    sessionRef: start.resumeRef,
    alive: true,
    tokensIn: 0,
    tokensOut: 0,
    cacheReadTokens: 0,
    costUsd: null,
    usageBase: start.usageBase ?? (attached !== null || start.resumeRef === null ? ZERO_USAGE : null),
    startedAt: 0,
    turnDone: false,
    held: false,
    questionHold: false,
    questionReportedFor: -1,
    permissionId: null,
    formId: null,
    turn: undefined,
    lastPromptAt: 0,
    ended: false,
    seenAssistant: new Set(),
    seenTools: new Set(),
    seenBeforeMs: attached?.seenBeforeMs ?? null,
    lastText: '',
    contextTokens: 0,
  };
}

/** What every part of one worker shares: its start, its state, the server and the clock. */
export interface OpencodeContext {
  readonly start: ProviderStart;
  readonly state: OpencodeState;
  readonly client: OpencodeClient;
  readonly now: NowFn;
  /** Kills the worker's process tree (the boot's server, or an attached worker's recorded one). */
  readonly kill: () => Promise<void>;
}

/** Emits one event stamped now. */
export function emitOf(ctx: Pick<OpencodeContext, 'start' | 'now'>): (event: Omit<NormalizedEvent, 'ts'>) => void {
  return (event) => ctx.start.onEvent({ ts: ctx.now().toISOString(), ...event });
}

/** Whether the worker can take a call: alive, its session known, the server bound. */
export function ready(ctx: Pick<OpencodeContext, 'state' | 'client'>): boolean {
  return ctx.state.alive && ctx.state.sessionRef !== null && ctx.client.bound;
}
