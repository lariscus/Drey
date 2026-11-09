import type { AcpClient } from './acp-client';
import type { AcpHarness } from './acp-harness';
import type { NormalizedEvent, NowFn, ProviderStart } from './contract';

/** One ACP worker's mutable state, shared by its parts. */
export interface AcpState {
  sessionId: string | null;
  /** `session/load` replays the history as updates: they are not this run's. */
  replaying: boolean;
  busy: boolean;
  held: boolean;
  ended: boolean;
  questionHold: boolean;
  /** An owner's free-text reply to a question that offers choices only: sent as the next turn. */
  followUp: string | null;
  /** The turn was cancelled to make room for a steer message. */
  steerAfterCancel: string | null;
  initDone: boolean;
  /** The model the session runs: the start's pin, else what the session said it runs. */
  model: string | null;
  /** The session's cumulative cost as the harness last reported it (`usage_update` → `cost`); null = it reports none. */
  reportedCost: number | null;
}

export function newAcpState(start: Pick<ProviderStart, 'model'>): AcpState {
  return {
    sessionId: null,
    replaying: false,
    busy: false,
    held: false,
    ended: false,
    questionHold: false,
    followUp: null,
    steerAfterCancel: null,
    initDone: false,
    model: start.model,
    reportedCost: null,
  };
}

/** What every part of one ACP worker shares. */
export interface AcpContext {
  readonly harness: AcpHarness;
  readonly start: ProviderStart;
  readonly state: AcpState;
  readonly acp: AcpClient;
  readonly now: NowFn;
  /** Ends the worker: input closed, the tree killed (once). */
  readonly finish: () => void;
}

export function acpEmit(ctx: Pick<AcpContext, 'start' | 'now'>): (event: Omit<NormalizedEvent, 'ts'>) => void {
  return (event) => ctx.start.onEvent({ ts: ctx.now().toISOString(), ...event });
}

export const acpText = (value: unknown): string => (typeof value === 'string' ? value : '');
