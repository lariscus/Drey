/**
 * The chain's pure dispatch rule (M85, ADR-0077): which card the machine
 * may take. The plan itself is `holder-plan.ts` — on the persona board the
 * holder of a ticket decides who runs it (req-257), never the column.
 */
import type { TicketCard } from '../../contracts/tickets';

/** A card the machine may take: unclaimed, unblemished, not already
 *  running, not blocked (T-0050 — a blocked ticket never enters a
 *  worker pool until its blockers reach the terminal phase), and not
 *  reserved for an interactive dialog (req-65 — `interactive: true`
 *  keeps the fleet's hands off while the owner plans or refines it in
 *  a conversation). */
export function dispatchable(card: TicketCard, busyTickets: ReadonlySet<string>): boolean {
  if (busyTickets.has(card.id) || card.meta.run !== null || card.meta.claimedBy !== null) {
    return false;
  }
  if (card.meta.interactive) {
    return false;
  }
  // E10-6: parked at a manual step — the owner finishes it, no run, no worktree.
  if (card.meta.awaiting !== undefined) {
    return false;
  }
  if (card.blocked.length > 0) {
    return false;
  }
  return !card.issues.some((issue) => issue.level === 'error');
}
