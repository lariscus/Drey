import type { AcpClient } from './acp-client';
import type { NormalizedEvent, NowFn, ProviderStart } from './contract';

/** One Kimi worker's mutable state, shared by its parts. */
export interface KimiState {
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
}

export function newKimiState(): KimiState {
  return { sessionId: null, replaying: false, busy: false, held: false, ended: false, questionHold: false, followUp: null, steerAfterCancel: null, initDone: false };
}

/** What every part of one Kimi worker shares. */
export interface KimiContext {
  readonly start: ProviderStart;
  readonly state: KimiState;
  readonly acp: AcpClient;
  readonly now: NowFn;
  /** Ends the worker: input closed, the tree killed (once). */
  readonly finish: () => void;
}

export function kimiEmit(ctx: Pick<KimiContext, 'start' | 'now'>): (event: Omit<NormalizedEvent, 'ts'>) => void {
  return (event) => ctx.start.onEvent({ ts: ctx.now().toISOString(), ...event });
}

export const kimiText = (value: unknown): string => (typeof value === 'string' ? value : '');
