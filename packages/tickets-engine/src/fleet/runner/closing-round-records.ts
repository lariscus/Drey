import type { JournalEntry } from '../../core/persona/persona-journal';
import type { ClosingProposal } from './closing-round-prompt';
import type { LiveRun } from './live-run';

/** What one closing round leaves in its persona's records (R14, req-169). */
export interface RoundRecord {
  readonly persona: string;
  readonly entry: JournalEntry;
  /** The lesson text as the round answered it; null = none (or the run saved its lesson itself, req-226). */
  readonly lesson: string | null;
  readonly proposal: ClosingProposal | null;
}

/** What was written. */
export interface RoundRecorded {
  /** The lesson line as written; null when none was. */
  readonly lesson: string | null;
  /** The minted proposal id; null when none was. */
  readonly proposal: string | null;
  /** The round's records are one commit in the tickets repository (req-225); false for a plain write. */
  readonly committed: boolean;
}

/**
 * Where a closing round's records go (req-225): to the engine's one writer
 * of the tickets repository — one commit per round — in Drey Service, or as
 * plain writes for a standalone runner. Never throws: a failure is a log line.
 */
export interface ClosingRoundRecords {
  write(run: LiveRun, record: RoundRecord): Promise<RoundRecorded>;
}
