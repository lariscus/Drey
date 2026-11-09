import type { PersonaSessionState } from '../contracts/persona-session';
import type { RunInfo } from '../fleet/protocol';
import { isOneOnOne, ONE_ON_ONE_IDLE_MS } from '../fleet/protocol-session';

const LIVE: readonly string[] = ['starting', 'running', 'stopping'];

/** The persona's live 1:1 run; null while it has none. */
export function liveOneOnOneOf(runs: readonly RunInfo[], persona: string): RunInfo | null {
  return runs.find((r) => isOneOnOne(r) && r.persona === persona && LIVE.includes(r.state)) ?? null;
}

export interface SessionStateInput {
  readonly runs: readonly RunInfo[];
  readonly persona: string;
  /** The persona talks over the chat bridge (`worker: api`). */
  readonly bridge: boolean;
  /** A line of the owner's is on its way to an answer. */
  readonly answering: boolean;
  readonly idleMs?: number;
}

export interface SessionStateView {
  readonly session: PersonaSessionState;
  readonly runId?: string;
  readonly releaseAt?: string;
}

/**
 * What the 1:1's clients show of the session behind it (req-168): none,
 * starting, answering, held (with the moment its idle release falls) or
 * the chat bridge. Read off the run records — the runner is the truth.
 */
export function sessionStateOf(input: SessionStateInput): SessionStateView {
  if (input.bridge) {
    return { session: input.answering ? 'answering' : 'bridge' };
  }
  const run = liveOneOnOneOf(input.runs, input.persona);
  if (run === null) {
    return { session: input.answering ? 'starting' : 'none' };
  }
  if (run.state === 'starting') {
    return { session: 'starting', runId: run.id };
  }
  if (input.answering || run.turn === 'busy') {
    return { session: 'answering', runId: run.id };
  }
  const last = Math.max(Date.parse(run.startedAt) || 0, Date.parse(run.lastActivity) || 0);
  return { session: 'held', runId: run.id, releaseAt: new Date(last + (input.idleMs ?? ONE_ON_ONE_IDLE_MS)).toISOString() };
}
