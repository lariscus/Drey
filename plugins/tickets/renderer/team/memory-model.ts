// i18n: catalog
/**
 * The Memory tab's rows (R14, req-169): the persona's memory lines and its
 * journal entries turned into what the pane draws — the words come from the
 * catalog through `t`, the pane only places them. Memory keeps file order
 * (oldest first, the order the run reads); the journal shows the newest
 * entry first. Each row carries what its removal must send back.
 */
import type { JournalEntry, PersonaMemoryEntry } from '../../shared/remote-protocol';

export type Words = (key: string, params?: Record<string, string | number>) => string;

export interface MemoryRow {
  readonly index: number;
  /** The lesson itself (the line without its evidence). */
  readonly text: string;
  /** Author and evidence: `you · 2026-11-09`, `ben/sonnet · T-0102 · 2026-11-09`; '' when the line names none. */
  readonly meta: string;
  readonly pinned: boolean;
  /** What the removal sends: the entry's stored text. */
  readonly key: string;
}

export interface JournalRow {
  readonly index: number;
  readonly head: string;
  readonly lines: readonly string[];
  /** What the removal sends: the entry's stamp. */
  readonly key: string;
}

function memoryMeta(entry: PersonaMemoryEntry, t: Words): string {
  const date = entry.date ?? '';
  if (entry.author === 'you') {
    return t('persona.memory.by_you', { date });
  }
  if (entry.author !== undefined && entry.author !== null) {
    const author = entry.model !== undefined && entry.model !== null ? `${entry.author}/${entry.model}` : entry.author;
    return t('persona.memory.by_persona', { author, ticket: entry.ticket ?? '—', date });
  }
  return date === '' ? '' : t('persona.memory.by_unknown', { date });
}

export function memoryRows(entries: readonly PersonaMemoryEntry[], t: Words): readonly MemoryRow[] {
  return entries.map((entry, index) => {
    const named = entry.author !== undefined && entry.author !== null;
    return { index, text: named ? (entry.lesson ?? entry.text) : entry.text, meta: named ? memoryMeta(entry, t) : '', pinned: entry.pinned, key: entry.text };
  });
}

const SIGNAL_KEYS: Readonly<Record<string, string>> = {
  'red-gate': 'persona.journal.signal.red_gate',
  retry: 'persona.journal.signal.retry',
  steer: 'persona.journal.signal.steer',
  cost: 'persona.journal.signal.cost',
  friction: 'persona.journal.signal.friction',
};

function journalHead(entry: JournalEntry, t: Words): string {
  const model = entry.model === null ? t('persona.journal.no_model') : entry.harness === null ? entry.model : `${entry.harness}/${entry.model}`;
  return t('persona.journal.head', {
    ticket: entry.ticket ?? t('persona.journal.no_ticket'),
    model,
    gate: t(`persona.journal.gate.${entry.gate}`),
    cost: entry.costUsd === null ? t('persona.journal.no_cost') : `$${entry.costUsd.toFixed(2)}`,
    date: entry.at.slice(0, 10),
  });
}

function journalLines(entry: JournalEntry, t: Words): string[] {
  const lines: string[] = [];
  if (entry.signals.length > 0) {
    lines.push(t('persona.journal.signals', { list: entry.signals.map((s) => t(SIGNAL_KEYS[s] ?? s)).join(', ') }));
  }
  if (entry.friction !== null) {
    lines.push(t('persona.journal.friction', { text: entry.friction }));
  }
  if (entry.finding !== null) {
    lines.push(t('persona.journal.finding', { cause: t(`persona.journal.cause.${entry.finding.cause}`), text: entry.finding.text }));
  }
  if (entry.note !== null) {
    lines.push(t('persona.journal.note', { text: entry.note }));
  }
  return lines;
}

/** Newest first; the index stays the entry's position in the file (what the removal addresses). */
export function journalRows(entries: readonly JournalEntry[], t: Words): readonly JournalRow[] {
  return entries.map((entry, index) => ({ index, head: journalHead(entry, t), lines: journalLines(entry, t), key: entry.at })).reverse();
}
