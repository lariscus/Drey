import { HELD_SESSION_KINDS, type SessionKind } from '../../../../shared/session-lifecycle';

/**
 * The session kinds of the Crew runner (R12, ADR-0093, ADR-0092 later
 * change): every unit of work is a session with a record of its own. A
 * `run` works a ticket in its worktree (every record before req-168 is
 * one); a `1:1` is the owner's conversation with a persona — its own
 * harness and model, no ticket, no worktree, the tickets repository
 * read-only (req-168); a `free` session is one the owner opened (or
 * accepted from Pia's card) in a directory they named, with the persona's
 * harness, no ticket (req-173). `shape` is typed only (req-229).
 */
export type { SessionKind, SessionState } from '../../../../shared/session-lifecycle';
export { HELD_SESSION_KINDS, sessionStateOf } from '../../../../shared/session-lifecycle';

export const SESSION_KINDS: readonly SessionKind[] = ['run', '1:1', 'shape', 'free'];

/**
 * What a start request carries when it is not a ticket run: the kind, the
 * persona it works as and the explicit working directory (R12) — for a
 * 1:1 also the chat session file that holds the conversation (R3).
 */
export type SessionSpec =
  | {
      readonly kind: '1:1';
      readonly persona: string;
      /** Absolute: where the worker starts — for a 1:1 the tickets repository, read-only. */
      readonly workingDirectory: string;
      /** Vault-relative: the persona's chat session file under `tickets/_meta/chat/`. */
      readonly chatFile: string;
    }
  | {
      readonly kind: 'free';
      readonly persona: string;
      /** Absolute: the directory the owner named — any existing folder, the tickets vault included (req-173). */
      readonly workingDirectory: string;
    };

/**
 * The ticket field of a 1:1's request and record: no ticket, one stable
 * marker — no ticket id matches it, so no lane, no claim and no ticket
 * ledger ever reads it as a ticket.
 */
export const ONE_ON_ONE_TICKET = '1:1';

/** The same marker for a free session (req-173). */
export const FREE_SESSION_TICKET = 'free';

/** A held 1:1 is released after this long without a turn (req-157's lifecycle as req-168 builds it) — shared with the service window. */
export { HELD_SESSION_IDLE_MS, ONE_ON_ONE_IDLE_MS } from '../../../../shared/session-lifecycle';

type Subject = { readonly kind?: SessionKind; readonly session?: SessionSpec };

/** The kind of a record or request; absent = a ticket run, every record written before req-168. */
export function sessionKindOf(subject: Subject): SessionKind {
  return subject.session?.kind ?? subject.kind ?? 'run';
}

/** A 1:1 session's record or request. */
export function isOneOnOne(subject: Subject): boolean {
  return sessionKindOf(subject) === '1:1';
}

/** A free session's record or request (req-173). */
export function isFreeSession(subject: Subject): boolean {
  return sessionKindOf(subject) === 'free';
}

/** A session held between the owner's lines and released after idle: a 1:1 or a free session (req-173). */
export function isHeldSession(subject: Subject): boolean {
  return HELD_SESSION_KINDS.includes(sessionKindOf(subject));
}

/** A ticket run — the only kind with a ticket, a gate and a move. */
export function isTicketRun(subject: Subject): boolean {
  return sessionKindOf(subject) === 'run';
}
