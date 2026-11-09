// i18n: catalog
import type { MessageKey, MessageParams } from '../../../../shared/i18n';
import type { PersonaJournalEntryView, PersonaMemoryEntryView } from '../api/dto';

/**
 * The team detail's Memory pane rows (R14, req-169): a memory line's
 * author and evidence, a journal entry's head and lines — the words from
 * the catalog through `t`, the template only places them. Mission Control's
 * twin of the desk's `memory-model.ts` (the two clients share no module).
 */
export type Translate = (key: MessageKey, params?: MessageParams) => string;

/** A memory line's author and evidence (`you · 2026-11-09`); '' when the line names none. */
export function memoryMeta(entry: PersonaMemoryEntryView, t: Translate): string {
  const date = entry.date ?? '';
  if (entry.author === 'you') {
    return t('persona.memory.by_you', { date });
  }
  if (entry.author !== undefined && entry.author !== null) {
    const author = entry.model !== undefined && entry.model !== null ? `${entry.author}/${entry.model}` : entry.author;
    return t('persona.memory.by_persona', { author, ticket: entry.ticket ?? '—', date });
  }
  return '';
}

/** The text a memory row shows: the lesson when the line names its author, else the whole line. */
export function memoryText(entry: PersonaMemoryEntryView): string {
  return entry.author !== undefined && entry.author !== null && entry.lesson !== undefined ? entry.lesson : entry.text;
}

export interface JournalRowView {
  /** The entry's position in the file (what the removal addresses). */
  readonly index: number;
  readonly at: string;
  readonly head: string;
  readonly lines: readonly string[];
}

const SIGNALS: Readonly<Record<string, MessageKey>> = {
  'red-gate': 'persona.journal.signal.red_gate',
  retry: 'persona.journal.signal.retry',
  steer: 'persona.journal.signal.steer',
  cost: 'persona.journal.signal.cost',
  friction: 'persona.journal.signal.friction',
};

const GATES: Readonly<Record<string, MessageKey>> = {
  green: 'persona.journal.gate.green',
  red: 'persona.journal.gate.red',
  none: 'persona.journal.gate.none',
};

const CAUSES: Readonly<Record<string, MessageKey>> = {
  model: 'persona.journal.cause.model',
  prompt: 'persona.journal.cause.prompt',
  task: 'persona.journal.cause.task',
  environment: 'persona.journal.cause.environment',
};

function headOf(entry: PersonaJournalEntryView, t: Translate): string {
  const model = entry.model === null ? t('persona.journal.no_model') : entry.harness === null ? entry.model : `${entry.harness}/${entry.model}`;
  return t('persona.journal.head', {
    ticket: entry.ticket ?? t('persona.journal.no_ticket'),
    model,
    gate: t(GATES[entry.gate] ?? 'persona.journal.gate.none'),
    cost: entry.costUsd === null ? t('persona.journal.no_cost') : `$${entry.costUsd.toFixed(2)}`,
    date: entry.at.slice(0, 10),
  });
}

function linesOf(entry: PersonaJournalEntryView, t: Translate): string[] {
  const lines: string[] = [];
  const signals = entry.signals.map((s) => SIGNALS[s]).filter((key): key is MessageKey => key !== undefined);
  if (signals.length > 0) {
    lines.push(t('persona.journal.signals', { list: signals.map((key) => t(key)).join(', ') }));
  }
  if (entry.friction !== null) {
    lines.push(t('persona.journal.friction', { text: entry.friction }));
  }
  if (entry.finding !== null) {
    lines.push(t('persona.journal.finding', { cause: t(CAUSES[entry.finding.cause] ?? 'persona.journal.cause.task'), text: entry.finding.text }));
  }
  if (entry.note !== null) {
    lines.push(t('persona.journal.note', { text: entry.note }));
  }
  return lines;
}

/** The journal, newest entry first. */
export function journalRows(entries: readonly PersonaJournalEntryView[], t: Translate): readonly JournalRowView[] {
  return entries.map((entry, index) => ({ index, at: entry.at, head: headOf(entry, t), lines: linesOf(entry, t) })).reverse();
}
