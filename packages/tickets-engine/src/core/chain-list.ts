/**
 * The chain's grammar (req-266, the persona board concept §6): a ticket's
 * chain is the full ordered list of personas, one entry per position.
 * Strict writer, strict parser: an entry outside the grammar refuses to
 * null — never a guess — and a chain with one unreadable entry is read as
 * no chain at all, because every later position would shift.
 *
 *     paul:shape; paul; ben; ralf(notify); tessa; you
 *
 * - `<persona>` — a persona id, lowercase words with dashes (`you` = the
 *   human persona).
 * - `:<mode>` — the run's mode, `shape` (the interactive entry) only.
 * - `(notify)` — the Bescheid rule on that position.
 *
 * On a dricket store the entries are joined by `;` in `x-chain`; in a
 * ticket file they are the `chain:` list. The same text is the plan's
 * `### Chain` line and a plan part's `chain:` detail line.
 */
import { CHAIN_MODES, type ChainEntry, type ChainMode, type ChainSendBack, type ChainStep } from '../contracts/chain';

const ENTRY_RE = /^([a-z][a-z0-9-]*)(?::([a-z][a-z0-9-]*))?(?:\s*\(\s*(notify)\s*\))?$/;

/** A persona id's grammar — the persona directory names under `_meta/personas/`. */
export const PERSONA_ID_RE = /^[a-z][a-z0-9-]*$/;

function isMode(value: string): value is ChainMode {
  return (CHAIN_MODES as readonly string[]).includes(value);
}

/** Parses one entry; null when the text is not the grammar. */
export function parseChainEntry(text: string): ChainEntry | null {
  const match = ENTRY_RE.exec(text.trim());
  if (match === null) {
    return null;
  }
  const mode = match[2];
  if (mode !== undefined && !isMode(mode)) {
    return null;
  }
  return { persona: match[1]!, mode: mode ?? null, notify: match[3] !== undefined };
}

/** Renders one entry canonically — the round trip with {@link parseChainEntry}. */
export function renderChainEntry(entry: ChainEntry): string {
  return `${entry.persona}${entry.mode === null ? '' : `:${entry.mode}`}${entry.notify ? '(notify)' : ''}`;
}

/** The whole chain as canonical strings — what the `chain:` list holds. */
export function renderChainEntries(entries: readonly ChainEntry[]): string[] {
  return entries.map((entry) => renderChainEntry(entry));
}

/** The chain as one line, entries joined by `; ` — `flow:`, `### Chain` and a part's `chain:` line. */
export function renderChainLine(entries: readonly ChainEntry[]): string {
  return renderChainEntries(entries).join('; ');
}

/** The raw entries of a chain written as a list or as one `;`-separated line. */
export function chainItemsOf(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw.map((item) => String(item)) : typeof raw === 'string' ? raw.split(';') : [];
  return items.map((item) => item.trim()).filter((item) => item !== '');
}

export type ChainParse =
  | { readonly ok: true; readonly entries: readonly ChainEntry[] }
  | { readonly ok: false; readonly bad: string };

/** Parses every entry; the first unreadable one fails the whole chain. */
export function parseChainItems(items: readonly string[]): ChainParse {
  const entries: ChainEntry[] = [];
  for (const item of items) {
    const entry = parseChainEntry(item);
    if (entry === null) {
      return { ok: false, bad: item };
    }
    entries.push(entry);
  }
  return { ok: true, entries };
}

/** The readable refusal for an entry outside the grammar. */
export function unreadableEntryMessage(bad: string): string {
  return `chain entry "${bad}" is not readable — a chain lists personas, e.g. "paul:shape; paul; ben; ralf; tessa; you"`;
}

/** Parses `x-sent-back` / `sent-back:` (`5>3`); null when absent or not the grammar. */
export function parseSendBack(raw: unknown): ChainSendBack | null {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  const match = /^(\d+)\s*>\s*(\d+)$/.exec(text);
  if (match === null) {
    return null;
  }
  const from = Number(match[1]);
  const to = Number(match[2]);
  return from >= 1 && to >= 1 && to < from ? { from, to } : null;
}

export function renderSendBack(sendBack: ChainSendBack): string {
  return `${sendBack.from}>${sendBack.to}`;
}

/**
 * The cursor a chain's states fold around: null = the ticket has not
 * started (no current position, all future); `entries.length + 1` = it is
 * done (all past).
 */
export function chainSteps(entries: readonly ChainEntry[], cursor: number | null): ChainStep[] {
  return entries.map((entry, index) => {
    const position = index + 1;
    const state = cursor === null ? 'future' : position < cursor ? 'past' : position === cursor ? 'current' : 'future';
    return { ...entry, position, state };
  });
}

/** Where a ticket is in its life, for its chain's cursor. */
export type ChainLife = 'queued' | 'active' | 'done';

/**
 * The cursor of a ticket's chain from where it stands: queued (Inbox,
 * Prioritized, or the pipeline's first column) has none, done is past the
 * last entry, anything else is `at` (1 when unset). Until req-257 walks
 * the chain, `at` is what the ticket file says — nothing advances it.
 */
export function chainCursor(entries: readonly ChainEntry[], at: number | undefined, life: ChainLife): number | null {
  if (life === 'queued') {
    return null;
  }
  return life === 'done' ? entries.length + 1 : Math.min(Math.max(at ?? 1, 1), Math.max(entries.length, 1));
}

/** The life a column stands for: Inbox / Prioritized / the first column queue, the last column is done. */
export function chainLifeOf(phaseId: string, pipelineIds: readonly string[]): ChainLife {
  if (phaseId === 'inbox' || phaseId === 'prioritized' || phaseId === pipelineIds[0]) {
    return 'queued';
  }
  return phaseId === pipelineIds[pipelineIds.length - 1] || phaseId === 'done' ? 'done' : 'active';
}

/** The number of leading positions no edit may touch: every past entry and the current one. */
export function lockedCount(cursor: number | null, length: number): number {
  return cursor === null ? 0 : Math.min(cursor, length);
}
