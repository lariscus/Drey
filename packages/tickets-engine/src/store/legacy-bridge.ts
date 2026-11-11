import { parse } from 'yaml';
import { PHASE_PIN_KEY } from '../core/lifecycle-stages';
import { EXTENSION_KEYS } from './extension-keys';
import { toDricketId } from './ids';

/**
 * The write half of the board bridge (E14-4b, ADR-0090). The board reads a
 * dricket record folded into the LEGACY ticket shape (`recordToBoardFile`), and
 * every board mutation (refine, header edits, parts, flow, moves) is still a
 * pure text patch of that legacy file. This module turns the patched legacy
 * text back into the dricket document that `dk put` takes — the inverse of
 * `recordToBoardFile`, no more.
 *
 * It decides nothing dricket decides: identity, claim, lease, epoch and `rev`
 * fields stay exactly as the CURRENT document (the one `dk` produced) has them,
 * `dk put` validates the result. Pure: no IO, no `dk`.
 */

const FENCE = '---';


/** The label a closed-and-archived ticket carries (the archive is a label under dricket, migration plan §3). */
export const ARCHIVED_LABEL = 'archived';

/** The label of a cancelled import placeholder that keeps a legacy number free (E14-3); it is not a ticket of the board. */
export const PLACEHOLDER_LABEL = 'placeholder';

export interface BridgeOptions {
  /** The stage the document gets (a lifecycle stage, req-265; on a store still on phase stages, the phase id). */
  readonly stage: string;
  /**
   * The interim column pin `x-phase` (req-265): a string sets it, null removes it, absent leaves
   * whatever the current document has.
   */
  readonly pin?: string | null;
  /** `true` adds the `archived` label, `false` removes it, absent leaves the labels. */
  readonly archived?: boolean;
}

interface Split {
  readonly header: string;
  readonly body: string;
}

function split(text: string): Split {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== FENCE) {
    throw new Error('not a ticket document: no front matter fence');
  }
  const close = lines.indexOf(FENCE, 1);
  if (close < 0) {
    throw new Error('not a ticket document: front matter is not closed');
  }
  return { header: lines.slice(1, close).join('\n'), body: lines.slice(close + 1).join('\n') };
}

/** One flat value: a single line, no fence-breaking newline. */
function flat(value: unknown): string {
  return String(value).replace(/\s*\n\s*/g, ' ').trim();
}

function listOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => flat(v)).filter((v) => v !== '');
  }
  return typeof value === 'string' && value.trim() !== '' ? [flat(value)] : [];
}

/** The dricket header values a legacy header implies. `null` = the key must not stay in the document. */
function fieldsOf(legacy: Record<string, unknown>, options: BridgeOptions): Map<string, string | null> {
  const out = new Map<string, string | null>([...typedFieldsOf(legacy, options.stage), ...extensionFieldsOf(legacy)]);
  if (options.pin !== undefined) {
    out.set(PHASE_PIN_KEY, options.pin);
  }
  return out;
}

/** dricket's own fields: stage, title, priority, repos, depends, parent. */
function typedFieldsOf(legacy: Record<string, unknown>, stage: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  out.set('stage', stage);
  if (typeof legacy['title'] === 'string') {
    out.set('title', flat(legacy['title']));
  }
  if (typeof legacy['priority'] === 'string') {
    out.set('priority', flat(legacy['priority']));
  }
  const repos = Array.isArray(legacy['repos']) ? listOf(legacy['repos']) : listOf(legacy['repo']);
  out.set('repos', repos.join(', '));
  out.set('depends', listOf(legacy['blocked-by']).map((id) => toDricketId(id) ?? id.toLowerCase()).join(', '));
  const parent = typeof legacy['parent'] === 'string' ? legacy['parent'] : '';
  out.set('parent', parent === '' ? '' : (toDricketId(parent) ?? parent.toLowerCase()));
  return out;
}

/** One Drey key as an `x-` value: a non-empty string or a number; null = absent. */
function extensionValue(value: unknown): string | null {
  if (typeof value === 'number') {
    return String(value);
  }
  return typeof value === 'string' && value.trim() !== '' ? flat(value) : null;
}

/** Drey's keys as `x-` fields: rank, the extension keys, interactive, chain, references, `entered-*`. */
function extensionFieldsOf(legacy: Record<string, unknown>): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const rank = legacy['rank'];
  out.set('x-rank', rank === undefined || rank === null ? null : flat(rank));
  for (const key of EXTENSION_KEYS) {
    out.set(`x-${key}`, extensionValue(legacy[key]));
  }
  out.set('x-interactive', legacy['interactive'] === true ? 'true' : null);
  const chain = listOf(legacy['chain']);
  out.set('x-chain', chain.length > 0 ? chain.join(';') : null);
  const references = listOf(legacy['references']);
  out.set('x-references', references.length > 0 ? references.join(',') : null);
  for (const [key, value] of Object.entries(legacy)) {
    if (/^entered-[a-z][a-z0-9-]*$/.test(key)) {
      out.set(`x-${key}`, value === null || value === undefined ? null : flat(value));
    }
  }
  return out;
}

/** Keys the legacy header owns: absent there = gone from the document. */
function isManagedExtension(key: string): boolean {
  return (
    key === 'x-rank' ||
    key === 'x-interactive' ||
    key === 'x-chain' ||
    key === 'x-references' ||
    EXTENSION_KEYS.some((k) => key === `x-${k}`) ||
    /^x-entered-/.test(key)
  );
}

/** Empty typed fields that stay as `key: ` lines (dk's own empty list fields). */
const KEPT_EMPTY: readonly string[] = ['repos', 'depends', 'parent'];

function headerOf(text: string): Record<string, unknown> {
  const parsed: unknown = parse(text);
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

/** The `labels:` line with the `archived` label added or removed. */
function labelsLine(value: string, archived: boolean): string {
  const labels = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== ARCHIVED_LABEL);
  if (archived) {
    labels.push(ARCHIVED_LABEL);
  }
  return `labels: ${labels.join(', ')}`;
}

/** What one line of the current header becomes: itself, its replacement, or nothing. */
function rewritten(line: string, wanted: ReadonlyMap<string, string | null>, written: Set<string>, archived: boolean | undefined): string[] {
  const colon = line.indexOf(':');
  const key = colon > 0 ? line.slice(0, colon) : '';
  if (key === 'labels' && archived !== undefined) {
    written.add(key);
    return [labelsLine(line.slice(colon + 1), archived)];
  }
  if (wanted.has(key)) {
    written.add(key);
    const value = wanted.get(key)!;
    return value === null ? [] : [`${key}: ${value}`];
  }
  return isManagedExtension(key) ? [] : [line];
}

/**
 * The dricket document for a patched legacy ticket text, built on `current` (the
 * document as stored now). Header lines keep their order; managed fields are
 * replaced, dropped or appended; the body is the legacy body byte for byte.
 */
export function legacyToDricketDocument(current: string, legacyText: string, options: BridgeOptions): string {
  const now = split(current);
  const legacy = split(legacyText);
  const wanted = fieldsOf(headerOf(legacy.header), options);
  const written = new Set<string>();
  const lines = now.header.split('\n').flatMap((line) => rewritten(line, wanted, written, options.archived));
  for (const [key, value] of wanted) {
    if (!written.has(key) && value !== null && (value !== '' || KEPT_EMPTY.includes(key))) {
      lines.push(`${key}: ${value}`);
    }
  }
  if (options.archived === true && !written.has('labels')) {
    lines.push(`labels: ${ARCHIVED_LABEL}`);
  }
  return `${FENCE}\n${lines.join('\n')}\n${FENCE}\n${legacy.body}`;
}
