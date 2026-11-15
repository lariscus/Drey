import { ALL_CLOSING_SIGNALS, type ClosingSignal } from '../pipeline/closing-signals';

/**
 * The persona journal (R14, req-169): `tickets/_meta/personas/<id>/reviews.md`,
 * one entry per noteworthy run — the run's facts (ticket, harness/model, gate,
 * cost, the signals that made it noteworthy), the worker's own `friction:`
 * and the closing round's finding ("where did it stumble: model or prompt?").
 * The journal is evidence for the owner and the report; it never enters a
 * run's or a 1:1's context. This module is the format; the writers are the
 * runner's closing round and the board's removal and migration.
 *
 *     # Reviews
 *
 *     - 2026-11-09T10:12:03Z · T-0102 · ben · claude-code/sonnet · gate red · $0.42
 *       - signals: red-gate, retry
 *       - friction: the brief named no test command
 *       - finding (prompt): the brief never said how the repo runs its tests
 */

export type FindingCause = 'model' | 'prompt' | 'task' | 'environment';
export const FINDING_CAUSES: readonly FindingCause[] = ['model', 'prompt', 'task', 'environment'];

export interface JournalFinding {
  readonly cause: FindingCause;
  readonly text: string;
}

export type JournalGate = 'green' | 'red' | 'none';

export interface JournalEntry {
  /** ISO stamp of the entry (a migrated friction line carries its date only). */
  readonly at: string;
  readonly ticket: string | null;
  readonly persona: string;
  /** The harness that ran (`claude-code`); null when unknown. */
  readonly harness: string | null;
  readonly model: string | null;
  readonly gate: JournalGate;
  readonly costUsd: number | null;
  readonly signals: readonly ClosingSignal[];
  /** The worker's own report, short; null when it reported none. */
  readonly friction: string | null;
  /** The closing round's verdict; null when the round did not run or found nothing. */
  readonly finding: JournalFinding | null;
  /** Why the entry carries no finding (`round skipped — …`, `migrated from friction.md`); null otherwise. */
  readonly note: string | null;
}

export const JOURNAL_HEADER = '# Reviews';
export const JOURNAL_FILE = 'reviews.md';
/** The journal keeps this many entries; the oldest go first. */
export const JOURNAL_ENTRY_CAP = 200;
export const JOURNAL_FRICTION_MAX = 300;
export const JOURNAL_FINDING_MAX = 500;
export const JOURNAL_NOTE_MAX = 200;
/** The `note:` of an entry the worker wrote itself through `journal_write` (req-226); its closing round merges into it. */
export const RUN_JOURNAL_NOTE = 'written during the run';

const NONE = '—';
const HEAD = /^- (\S+) · (T-\d{4,}|—) · ([a-z0-9][a-z0-9-]{0,63}) · (\S+) · gate (green|red|none) · (\$\d+(?:\.\d+)?|—)$/;

/** One line, bounded: what every free-text field of an entry is stored as. */
export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function harnessModel(entry: JournalEntry): string {
  if (entry.model === null) {
    return NONE;
  }
  return entry.harness === null ? entry.model : `${entry.harness}/${entry.model}`;
}

/** The entry's stored lines (head + fields), canonical. */
export function renderJournalEntry(entry: JournalEntry): string[] {
  const cost = entry.costUsd === null ? NONE : `$${entry.costUsd.toFixed(2)}`;
  const lines = [`- ${entry.at} · ${entry.ticket ?? NONE} · ${entry.persona} · ${harnessModel(entry)} · gate ${entry.gate} · ${cost}`];
  if (entry.signals.length > 0) {
    lines.push(`  - signals: ${entry.signals.join(', ')}`);
  }
  if (entry.friction !== null && entry.friction.trim() !== '') {
    lines.push(`  - friction: ${oneLine(entry.friction, JOURNAL_FRICTION_MAX)}`);
  }
  if (entry.finding !== null) {
    lines.push(`  - finding (${entry.finding.cause}): ${oneLine(entry.finding.text, JOURNAL_FINDING_MAX)}`);
  }
  if (entry.note !== null && entry.note.trim() !== '') {
    lines.push(`  - note: ${oneLine(entry.note, JOURNAL_NOTE_MAX)}`);
  }
  return lines;
}

function splitHarnessModel(raw: string): { harness: string | null; model: string | null } {
  if (raw === NONE) {
    return { harness: null, model: null };
  }
  const slash = raw.indexOf('/');
  return slash === -1 ? { harness: null, model: raw } : { harness: raw.slice(0, slash), model: raw.slice(slash + 1) };
}

function signalsOf(raw: string): ClosingSignal[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is ClosingSignal => (ALL_CLOSING_SIGNALS as readonly string[]).includes(s));
}

type Fields = { signals: ClosingSignal[]; friction: string | null; finding: JournalFinding | null; note: string | null };

function readField(line: string, fields: Fields): void {
  const field = /^- (signals|friction|note|finding \((model|prompt|task|environment)\)): (.+)$/.exec(line.trim());
  if (field === null) {
    return;
  }
  const value = field[3]!.trim();
  if (field[1] === 'signals') {
    fields.signals = signalsOf(value);
  } else if (field[1] === 'friction') {
    fields.friction = value;
  } else if (field[1] === 'note') {
    fields.note = value;
  } else {
    fields.finding = { cause: field[2] as FindingCause, text: value };
  }
}

/** One entry block (its head line first), or null when the head does not parse. */
export function parseJournalBlock(lines: readonly string[]): JournalEntry | null {
  const head = HEAD.exec((lines[0] ?? '').trim());
  if (head === null) {
    return null;
  }
  const fields: Fields = { signals: [], friction: null, finding: null, note: null };
  for (const line of lines.slice(1)) {
    readField(line, fields);
  }
  const cost = head[6]!;
  return {
    at: head[1]!,
    ticket: head[2] === NONE ? null : head[2]!,
    persona: head[3]!,
    ...splitHarnessModel(head[4]!),
    gate: head[5] as JournalGate,
    costUsd: cost === NONE ? null : Number(cost.slice(1)),
    ...fields,
  };
}
