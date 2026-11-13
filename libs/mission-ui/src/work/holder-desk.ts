import type { PhoneWorkGroup } from './phone-rows';
import type { TicketVm, WorkGroup } from './work.model';

/**
 * The desk's wide list on a persona board (concept §11, "Mission Control
 * desk"): the need cards first, then one group per holder in the crew's order
 * — You's approvals (the tickets at You without a need card) as You's group
 * right after them — each head carrying the holder's load (`Ben · 2/2 ·
 * 1 waiting`), then the lifecycle groups. Built from the same holder groups
 * the phone and the iPad draw (`holderGroupsOf`), so the three faces agree.
 */
export function personaDeskGroupsOf(all: readonly WorkGroup[], holders: readonly PhoneWorkGroup[], youTitle: string): WorkGroup[] {
  const out: WorkGroup[] = [];
  const needs = all.find((group) => group.kind === 'needs');
  if (needs !== undefined) {
    out.push(needs);
  }
  const asked = new Set(needs?.kind === 'needs' ? needs.needs.map((vm) => vm.need.ticketId ?? '') : []);
  for (const group of holders) {
    const tickets = group.rows.flatMap((row): TicketVm[] => (row.ticket === null || asked.has(row.ticket.id) ? [] : [row.ticket]));
    if (tickets.length === 0) {
      continue;
    }
    // The Needs-you group's tickets without a need card are You's approvals.
    const title = group.key === 'needs' ? youTitle : (group.load ?? group.title);
    const key = group.key === 'needs' ? 'lane:you' : group.key;
    out.push({ kind: 'phase', key, phaseId: tickets[0]!.phaseId, title, unknown: false, tickets });
  }
  return out;
}
