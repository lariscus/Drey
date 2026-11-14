/**
 * What a run writes into its persona's records (req-225, req-226): the
 * closing round's journal entry, lesson and proposal as one commit, and the
 * worker's own `memory_write` / `journal_write` during the run. The engine's
 * `PersonaRunRecords` service is the one writer: the runner and Drey
 * Service's vault MCP hand it these payloads over the engine's invoke
 * channel, so the tickets repository has one git queue.
 */
import type { JournalEntry } from '../core/persona-journal';
import type { PromptEdit } from '../core/prompt-edits';

/** The invoke names of these writes (req-225, req-226); Drey Service calls them in-process. */
export const PERSONA_RUN_METHODS = { closingRound: 'personaClosingRound', memory: 'personaRunMemory', journal: 'personaRunJournal' } as const;

/** A closing round's change proposal (R11): a prompt.md edit set or a model id, decided by the owner in the 1:1. */
export interface RoundProposalWrite {
  readonly target: 'prompt.md' | 'models.default';
  readonly title: string;
  /** The model id; empty for a prompt.md proposal, whose text comes from `edits`. */
  readonly content: string;
  readonly edits?: readonly PromptEdit[];
  /** The journal head line the proposal cites as its evidence. */
  readonly evidence: string;
}

/** One closing round's records, written and committed together. */
export interface ClosingRoundWrite {
  /** The tickets vault the run worked (the engine refuses a write for another vault). */
  readonly vaultPath: string;
  readonly persona: string;
  /** `T-0102`, or null for a run without a ticket id. */
  readonly ticket: string | null;
  /** ISO start of the run: a `journal_write` entry of this run (stamped since) is merged with the round's. */
  readonly runStartedAt: string;
  readonly journal: JournalEntry;
  /** The lesson as its stored memory line (`personaLessonLine`); null = none. */
  readonly lesson: string | null;
  readonly proposal: RoundProposalWrite | null;
}

export type ClosingRoundWritten =
  | {
      readonly ok: true;
      /** The lesson line as written; null when none was due or the same lesson already stood. */
      readonly lesson: string | null;
      /** The minted proposal id; null when none was due or its edits did not apply. */
      readonly proposal: string | null;
      /** Set when the files landed but the commit did not (or the vault is not in git). */
      readonly warning?: string;
    }
  /** `foreign`: the run's vault is not the engine's — the runner writes it itself, as without an engine. */
  | { readonly ok: false; readonly error: string; readonly foreign?: true };

/** Whose run writes: the persona, its ticket, the harness and model the run used. */
export interface RunRecordAuthor {
  readonly persona: string;
  readonly ticket: string;
  readonly harness: string;
  readonly model: string;
}

/** The worker's `memory_write` (req-226): one lesson, stored in the persona line form. */
export interface RunMemoryWrite extends RunRecordAuthor {
  readonly lesson: string;
}

/** The worker's `journal_write` (req-226): one note, stored as a journal entry's `friction:` field. */
export interface RunJournalWrite extends RunRecordAuthor {
  readonly note: string;
}

export type RunRecordReply = { readonly ok: true; readonly line: string; readonly warning?: string } | { readonly ok: false; readonly error: string };
