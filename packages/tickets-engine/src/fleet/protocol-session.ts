/**
 * The session kinds of the Crew runner (R12, ADR-0093): every unit of work
 * is a session with a record of its own. A `run` works a ticket in its
 * worktree (every record before req-168 is one); a `1:1` is the owner's
 * conversation with a persona — its own harness and model, no ticket, no
 * worktree, the tickets repository read-only (req-168). `shape` and `free`
 * are req-173's: typed here so they slot in, built nowhere yet.
 */
export type SessionKind = 'run' | '1:1' | 'shape' | 'free';

export const SESSION_KINDS: readonly SessionKind[] = ['run', '1:1', 'shape', 'free'];

/**
 * What a start request carries when it is not a ticket run (req-168): the
 * kind, the persona it talks as, the explicit working directory (R12) and
 * the chat session file that holds the conversation (R3).
 */
export interface SessionSpec {
  readonly kind: '1:1';
  readonly persona: string;
  /** Absolute: where the worker starts — for a 1:1 the tickets repository, read-only. */
  readonly workingDirectory: string;
  /** Vault-relative: the persona's chat session file under `tickets/_meta/chat/`. */
  readonly chatFile: string;
}

/**
 * The ticket field of a 1:1's request and record: no ticket, one stable
 * marker — no ticket id matches it, so no lane, no claim and no ticket
 * ledger ever reads it as a ticket.
 */
export const ONE_ON_ONE_TICKET = '1:1';

/** A held 1:1 is released after this long without a turn (req-157's lifecycle as req-168 builds it) — shared with the service window. */
export { ONE_ON_ONE_IDLE_MS } from '../../../../shared/session-lifecycle';

/** The kind of a record or request; absent = a ticket run, every record written before req-168. */
export function sessionKindOf(subject: { readonly kind?: SessionKind; readonly session?: SessionSpec }): SessionKind {
  return subject.session?.kind ?? subject.kind ?? 'run';
}

/** A 1:1 session's record or request. */
export function isOneOnOne(subject: { readonly kind?: SessionKind; readonly session?: SessionSpec }): boolean {
  return sessionKindOf(subject) === '1:1';
}
