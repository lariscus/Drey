import type { CapabilityClass } from '../protocol-pool';
import type { RunInfo, WorkerProviderId } from '../protocol';
import { sessionKindOf, sessionStateOf, type SessionKind, type SessionState } from '../protocol-session';

/**
 * The session record of R12 (req-173, ADR-0092 later change): every unit
 * of work Drey Service carries — a ticket run, a 1:1, a free session — as
 * one record of its own. It is a view over the run record
 * (`runs/<id>/run.json`), not a second store: the runner already keeps
 * everything a session is, and one file stays the truth. `GET /sessions`
 * answers these; the service window and the clients name kind, state and
 * directory from them.
 */
export interface SessionRecord {
  readonly id: string;
  readonly kind: SessionKind;
  readonly persona: string | null;
  readonly harness: WorkerProviderId;
  readonly model: string | null;
  /** The class the pool granted; null before the pool or without a table row. */
  readonly class: CapabilityClass | null;
  /** Where the worker works: the worktree, the tickets repository (1:1), the folder the owner named (free). */
  readonly workingDirectory: string;
  readonly state: SessionState;
  /** The ticket of a run; null for every other kind. */
  readonly ticketId: string | null;
  /** The worker's vault-MCP token, by reference: the run id it is keyed by in the service (req-167); null = no token. */
  readonly token: string | null;
  /** The ledgers the session counts on (ADR-0095): the ticket's (runs only), the persona's, the provider's. */
  readonly ledgers: { readonly ticket: string | null; readonly persona: string | null; readonly provider: WorkerProviderId };
  /** The stream file, relative to the fleet root. */
  readonly stream: string;
  readonly permission: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

/** The run record as a session record. */
export function sessionRecordOf(info: RunInfo, permission: string | null = null): SessionRecord {
  const kind = sessionKindOf(info);
  const ticketId = kind === 'run' ? info.ticketId : null;
  const persona = info.persona ?? null;
  return {
    id: info.id,
    kind,
    persona,
    harness: info.provider,
    model: info.grant?.model ?? info.model ?? null,
    class: info.grant?.class ?? null,
    workingDirectory: info.workingDirectory ?? info.review?.checkout ?? info.worktreePath,
    state: sessionStateOf(info),
    ticketId,
    token: info.vaultMcp === true ? info.id : null,
    ledgers: { ticket: ticketId, persona, provider: info.provider },
    stream: `runs/${info.id}/stream.jsonl`,
    permission,
    startedAt: info.startedAt,
    endedAt: info.endedAt,
  };
}
