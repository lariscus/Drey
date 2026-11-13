/**
 * The Crew list on a persona board (req-273, concept §9, §11): the personas
 * in the crew's order — the board's lanes — what each one holds now, and the
 * pure steps of a reorder. The raw board is read tolerantly through
 * `work/hold.ts`; nothing here knows the wire beyond that.
 */
import { holdOf, lanesOf } from '../work/hold';

type Rec = Record<string, unknown>;
const rec = (raw: unknown): Rec | null => (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Rec) : null);

/** The crew's order off the board's lanes; null = no persona board (the phase board, or nothing read yet). */
export function laneIdsOf(board: unknown): readonly string[] | null {
  const lanes = lanesOf(rec(board) as { lanes?: unknown } | null);
  return lanes === null ? null : lanes.map((lane) => lane.persona);
}

/** Per persona: how many active tickets it holds right now (`hold.holder`). */
export function heldCountsOf(board: unknown): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  const columns = rec(board)?.['columns'];
  for (const column of Array.isArray(columns) ? columns : []) {
    const tickets = rec(column)?.['tickets'];
    for (const ticket of Array.isArray(tickets) ? tickets : []) {
      const hold = holdOf(rec(ticket));
      if (hold !== null) {
        out.set(hold.holder, (out.get(hold.holder) ?? 0) + 1);
      }
    }
  }
  return out;
}

/** The items in `order`; an item the order does not name follows, in its own order. */
export function inOrderOf<P extends { readonly id: string }>(items: readonly P[], order: readonly string[]): P[] {
  const at = (id: string): number => {
    const found = order.indexOf(id);
    return found === -1 ? Number.MAX_SAFE_INTEGER : found;
  };
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => at(a.item.id) - at(b.item.id) || a.index - b.index)
    .map((entry) => entry.item);
}

/** `ids` with `id` taken out and put at `to` (clamped); the same list when it is not there. */
export function movedTo(ids: readonly string[], id: string, to: number): readonly string[] {
  const from = ids.indexOf(id);
  if (from === -1) {
    return ids;
  }
  const rest = ids.filter((other) => other !== id);
  rest.splice(Math.max(0, Math.min(rest.length, to)), 0, id);
  return rest;
}

/** One place up (-1) or down (1); the same list at the ends. */
export function movedBy(ids: readonly string[], id: string, dir: -1 | 1): readonly string[] {
  const from = ids.indexOf(id);
  return from === -1 ? ids : movedTo(ids, id, from + dir);
}

/** Whether two orders are the same list. */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, at) => id === b[at]);
}
