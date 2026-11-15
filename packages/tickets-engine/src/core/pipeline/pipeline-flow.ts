/**
 * The standard flow (req-266, the persona board concept §6): one key in
 * `tickets/_meta/pipeline.md`, the chain a new ticket gets copied in at
 * creation — `flow: paul:shape; paul; ben; ralf; tessa; you` (a YAML list
 * reads the same). Absent = no standard flow: a new ticket carries no chain.
 * An unreadable entry drops the whole key with a warning, never a guess.
 */
import type { ChainEntry } from '../../contracts/chain';
import type { TicketIssue } from '../../contracts/tickets';
import { chainItemsOf, parseChainItems, unreadableEntryMessage } from './chain-list';

export const FLOW_KEY = 'flow';

export function parsePipelineFlow(raw: unknown, issues: TicketIssue[]): readonly ChainEntry[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  const parsed = parseChainItems(chainItemsOf(raw));
  if (!parsed.ok) {
    issues.push({ level: 'warning', message: `pipeline.md flow: ${unreadableEntryMessage(parsed.bad)} — no standard flow` });
    return [];
  }
  return parsed.entries;
}

export const PROPOSE_FLOW_KEY = 'propose-flow';

/**
 * E10-5b: `propose-flow: true` — the plan persona proposes a flow for every
 * new plan (its brief makes `### Chain` a chapter every plan carries). Absent
 * or `false` = off; any other value reads as off with a warning.
 */
export function parseProposeFlow(raw: unknown, issues: TicketIssue[]): boolean {
  if (raw === undefined || raw === null || raw === false) {
    return false;
  }
  if (raw === true) {
    return true;
  }
  issues.push({ level: 'warning', message: `pipeline.md ${PROPOSE_FLOW_KEY}: must be true or false — read as false` });
  return false;
}
