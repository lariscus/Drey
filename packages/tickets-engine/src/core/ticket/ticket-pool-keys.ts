import type { ModelNeeds } from '../../contracts/ticket-pool-meta';
import type { TicketIssue, TicketMeta } from '../../contracts/tickets';
import { classNameOf } from '../../contracts/capability-class';
import { parseNeeds } from '../config/model-needs';

/**
 * The ticket keys the capacity pool reads (req-170, specs/ticket-schema.md):
 * `class:` (a class name of Settings → Models; req-287 reads the old A | B | C as heavy | standard | light) and `model:` pin what the run asks for, `size:`
 * (S | M | L — a plan part's size) asks for its class, `allowance:` is the
 * ticket's ledger in USD, `needs:` (req-178) the capabilities its model
 * must have. Tolerant like the rest of the reader: a value outside the
 * grammar warns and reads as unset, never as a guess.
 */
export type TicketPoolKeys = Pick<TicketMeta, 'class' | 'model' | 'size' | 'allowance' | 'needs'>;

const text = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
};

function classOf(raw: string | null, issues: TicketIssue[]): TicketPoolKeys['class'] {
  if (raw === null) {
    return null;
  }
  const name = classNameOf(raw);
  if (name !== null) {
    return name;
  }
  issues.push({ level: 'warning', message: 'class must be a class name such as heavy or light — read as no class pin' });
  return null;
}

function sizeOf(raw: string | null, issues: TicketIssue[]): TicketPoolKeys['size'] {
  if (raw === null) {
    return null;
  }
  if (raw === 'S' || raw === 'M' || raw === 'L') {
    return raw;
  }
  issues.push({ level: 'warning', message: 'size must be S, M or L — read as no size' });
  return null;
}

function allowanceOf(raw: string | null, issues: TicketIssue[]): number | null {
  if (raw === null) {
    return null;
  }
  const amount = Number(raw.replace(/^\$/, ''));
  if (Number.isFinite(amount) && amount >= 0) {
    return amount;
  }
  issues.push({ level: 'warning', message: 'allowance must be an amount in USD (2.50) — read as the default' });
  return null;
}

/** req-178: what the run's model must be able to do; an unknown token warns and drops. */
function needsOf(raw: unknown, issues: TicketIssue[]): ModelNeeds | null {
  const parsed = parseNeeds(raw);
  if (parsed.unknown.length > 0) {
    issues.push({ level: 'warning', message: `needs: ${parsed.unknown.join(', ')} is not image, tools, context-<n> or output-<n> — left out` });
  }
  return parsed.needs;
}

/** The pool keys of one frontmatter object; only the set ones land on the meta. */
export function parseTicketPoolKeys(obj: Readonly<Record<string, unknown>>, issues: TicketIssue[]): Partial<TicketPoolKeys> {
  const pinClass = classOf(text(obj['class']), issues);
  const model = text(obj['model']);
  const size = sizeOf(text(obj['size']), issues);
  const allowance = allowanceOf(text(obj['allowance']), issues);
  const needs = needsOf(obj['needs'], issues);
  return {
    ...(pinClass !== null ? { class: pinClass } : {}),
    ...(model !== null ? { model } : {}),
    ...(size !== null ? { size } : {}),
    ...(allowance !== null ? { allowance } : {}),
    ...(needs !== null ? { needs } : {}),
  };
}
