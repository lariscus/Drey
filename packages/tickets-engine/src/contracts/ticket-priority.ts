/**
 * The ticket priority vocabulary (req-63): the default list, pipeline.md's
 * `priorities:`, the weight and the dispatch class. Split out of
 * `tickets.ts` with req-177 (the size baseline's ratchet); that file
 * re-exports every name.
 */
import type { TicketIssue } from './tickets';

/**
 * A priority id from the vault's configured vocabulary — `urgent` in the
 * default list, or whatever pipeline.md's `priorities:` names (`p0`,
 * `critical`, …). The order of the list IS the weight: first is highest.
 */
export type TicketPriority = string;

/** The default vocabulary — what a vault without `priorities:` gets. */
export const TICKET_PRIORITIES: readonly TicketPriority[] = [
  'urgent',
  'high',
  'normal',
  'low',
];

/** The vault's priority vocabulary: the order IS the weight (first = highest). */
export interface PriorityConfig {
  readonly order: readonly TicketPriority[];
  /** What a ticket whose file omits (or misspells) `priority:` reads as. */
  readonly default: TicketPriority;
}

export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = { order: TICKET_PRIORITIES, default: 'normal' };

/**
 * pipeline.md's `priorities:` — a list of ids in weight order. The
 * vocabulary splits at its middle (`floor(len/2)`): the entries before
 * it are the dispatch's jump class (req-63), the entry at it is the
 * default (`normal` in the default list of four), the rest is the calm
 * half. Forgiving: anything unreadable is a noise issue and the default
 * vocabulary applies.
 */
export function parsePriorityConfig(raw: unknown): { config: PriorityConfig; issues: TicketIssue[] } {
  if (raw === undefined || raw === null) {
    return { config: DEFAULT_PRIORITY_CONFIG, issues: [] };
  }
  if (!Array.isArray(raw)) {
    return {
      config: DEFAULT_PRIORITY_CONFIG,
      issues: [{ level: 'noise', message: 'priorities must be a list of ids — the default vocabulary applies' }],
    };
  }
  const issues: TicketIssue[] = [];
  const order: TicketPriority[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || !PRIORITY_ID.test(entry)) {
      issues.push({
        level: 'noise',
        message: `priorities: "${String(entry)}" is not a readable id — dropped`,
      });
      continue;
    }
    if (order.includes(entry)) {
      issues.push({ level: 'noise', message: `priorities: "${entry}" appears twice — first wins` });
      continue;
    }
    order.push(entry);
  }
  if (order.length === 0) {
    issues.push({ level: 'noise', message: 'priorities is empty — the default vocabulary applies' });
    return { config: DEFAULT_PRIORITY_CONFIG, issues };
  }
  return { config: { order, default: order[Math.floor(order.length / 2)]! }, issues };
}

/** A priority id in the configured vocabulary (`p0`, `critical`). */
const PRIORITY_ID = /^[a-z][a-z0-9-]*$/;

/** Sort weight inside derived column order — the configured index; smaller sorts first, an unknown id sorts last. */
export function priorityWeight(priority: TicketPriority, config: PriorityConfig = DEFAULT_PRIORITY_CONFIG): number {
  const at = config.order.indexOf(priority);
  return at === -1 ? config.order.length : at;
}

/**
 * The dispatch class (req-63): the entries before the vocabulary's
 * middle jump the queue, the rest waits — `urgent` and `high` in the
 * default list. An unknown id waits.
 */
export function priorityClass(priority: TicketPriority, config: PriorityConfig = DEFAULT_PRIORITY_CONFIG): 0 | 1 {
  const at = config.order.indexOf(priority);
  return at >= 0 && at < Math.floor(config.order.length / 2) ? 0 : 1;
}
