import type { JournalEntry } from '../core/persona-journal';

/**
 * The Memory tab's two lists (R14, req-169) as the routes carry them.
 *
 * Memory (`GET /api/personas/<id>/memory`): every entry in file order, its
 * pin and — since req-169 — its author and evidence; `author` is `you` for
 * the owner, the persona id for a persona's lesson, null for a line written
 * before the line form named one.
 */
export interface PersonaMemoryEntry {
  readonly text: string;
  readonly pinned: boolean;
  readonly author?: string | null;
  readonly model?: string | null;
  readonly date?: string | null;
  readonly ticket?: string | null;
  readonly lesson?: string;
}

export type PersonaMemoryReply =
  | { readonly ok: true; readonly entries: readonly PersonaMemoryEntry[]; readonly warning?: string }
  | { readonly ok: false; readonly error: string };

/** The journal (`GET /api/personas/<id>/journal`): the parseable entries, oldest first; the index addresses this list. */
export type PersonaJournalReply =
  | { readonly ok: true; readonly entries: readonly JournalEntry[]; readonly warning?: string }
  | { readonly ok: false; readonly error: string };

/** One memory line's removal: its index in the GET list and the text the client saw. */
export interface PersonaMemoryRemove {
  readonly persona: string;
  readonly index: number;
  readonly text: string;
}

/** One journal entry's removal: its index in the GET list and its stamp. */
export interface PersonaJournalRemove {
  readonly persona: string;
  readonly index: number;
  readonly at: string;
}

export type { JournalEntry, JournalFinding, JournalGate, FindingCause } from '../core/persona-journal';
