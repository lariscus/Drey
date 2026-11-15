import { parseFriction, type FrictionLine } from './improvements';
import { JOURNAL_ENTRY_CAP, JOURNAL_HEADER, parseJournalBlock, renderJournalEntry, RUN_JOURNAL_NOTE, type JournalEntry } from './persona-journal';

/**
 * The journal file as blocks (req-169): every entry is a block that starts
 * with a `- ` line at column 0, its fields indented below. A block whose head
 * does not parse is kept verbatim on every rewrite but never listed — a
 * hand-edit is never lost to a strict re-render. An entry's index is its
 * position among the parseable blocks, oldest first.
 */

interface JournalBlocks {
  readonly header: string[];
  readonly blocks: string[][];
}

function blocksOf(text: string): JournalBlocks {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const header: string[] = [];
  const blocks: string[][] = [];
  for (const line of lines) {
    if (line.startsWith('- ')) {
      blocks.push([line]);
    } else if (blocks.length > 0) {
      if (line.trim() !== '') {
        blocks[blocks.length - 1]!.push(line);
      }
    } else if (line.trim() !== '' || header.length > 0) {
      header.push(line);
    }
  }
  while (header.length > 0 && header[header.length - 1]!.trim() === '') {
    header.pop();
  }
  return { header: header.length === 0 ? [JOURNAL_HEADER] : header, blocks };
}

function render(file: JournalBlocks): string {
  return `${[...file.header, '', ...file.blocks.flat()].join('\n')}\n`;
}

/** The parseable entries in file order (oldest first). */
export function parseJournal(text: string): readonly JournalEntry[] {
  return blocksOf(text)
    .blocks.map((block) => parseJournalBlock(block))
    .filter((entry): entry is JournalEntry => entry !== null);
}

/**
 * The file with these entries added — at the end (a run's entry) or at the
 * start (the migrated friction lines, older than any run's) — capped at
 * {@link JOURNAL_ENTRY_CAP} blocks, the oldest dropped first. A missing file
 * starts with the `# Reviews` header.
 */
export function withJournalEntries(existing: string | null, entries: readonly JournalEntry[], at: 'end' | 'start' = 'end'): string {
  const file = blocksOf(existing ?? '');
  const added = entries.map((entry) => renderJournalEntry(entry));
  const blocks = at === 'end' ? [...file.blocks, ...added] : [...added, ...file.blocks];
  return render({ header: file.header, blocks: blocks.slice(Math.max(0, blocks.length - JOURNAL_ENTRY_CAP)) });
}

/** The block index of the run's own `journal_write` entry: same persona and ticket, stamped at or after `since`; -1 when none. */
function runEntryIndex(blocks: readonly string[][], entry: JournalEntry, since: string): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const held = parseJournalBlock(blocks[i]!);
    if (held !== null && held.note === RUN_JOURNAL_NOTE && held.persona === entry.persona && held.ticket === entry.ticket && held.at >= since) {
      return i;
    }
  }
  return -1;
}

/**
 * The file with a closing round's entry (req-226): when the run wrote its
 * own note through `journal_write` (same persona and ticket, at or after the
 * run's start `since`), the round's entry takes that entry's place and keeps
 * its note as the `friction:` when the round brought none — one entry per
 * run, as the report counts them. Otherwise the entry is appended.
 */
export function withRoundEntry(existing: string | null, entry: JournalEntry, since: string): string {
  const file = blocksOf(existing ?? '');
  const at = runEntryIndex(file.blocks, entry, since);
  if (at === -1) {
    return withJournalEntries(existing, [entry]);
  }
  const held = parseJournalBlock(file.blocks[at]!)!;
  const merged: JournalEntry = { ...entry, friction: entry.friction ?? held.friction };
  return render({ header: file.header, blocks: file.blocks.map((block, i) => (i === at ? renderJournalEntry(merged) : block)) });
}

/**
 * The file without the entry at `index` (its position in {@link parseJournal}),
 * or null when no entry is there or it is not the one the caller saw —
 * `expectAt` is the entry's stamp, so a removal never hits a neighbour after
 * the file moved under the client.
 */
export function withoutJournalEntry(text: string, index: number, expectAt: string): string | null {
  const file = blocksOf(text);
  let seen = -1;
  for (let i = 0; i < file.blocks.length; i++) {
    const entry = parseJournalBlock(file.blocks[i]!);
    if (entry === null) {
      continue;
    }
    seen++;
    if (seen === index) {
      return entry.at === expectAt ? render({ header: file.header, blocks: file.blocks.filter((_, j) => j !== i) }) : null;
    }
  }
  return null;
}

/**
 * The improvement loop's input (E6, req-169): the journal's `friction:`
 * fields newer than the last aggregation (all of them when never), in the
 * shape the aggregator always read. The journal is never truncated: the
 * aggregation's stamp is the cut.
 */
export function journalFrictions(text: string, since: string | null): readonly FrictionLine[] {
  return parseJournal(text)
    .filter((entry) => entry.friction !== null && (since === null || entry.at > since))
    .map((entry) => ({ at: entry.at.slice(0, 10), ticket: entry.ticket, text: entry.friction! }));
}

/**
 * The retired `friction.md` as journal entries (req-169): each readable
 * line becomes an entry with its date, ticket and the line as `friction:`,
 * no model and no gate (the old file never knew them), noted as migrated.
 */
export function journalFromFriction(frictionText: string, persona: string): readonly JournalEntry[] {
  return parseFriction(frictionText).map((line) => ({
    at: line.at,
    ticket: line.ticket,
    persona,
    harness: null,
    model: null,
    gate: 'none',
    costUsd: null,
    signals: ['friction'],
    friction: line.text,
    finding: null,
    note: 'migrated from friction.md',
  }));
}
