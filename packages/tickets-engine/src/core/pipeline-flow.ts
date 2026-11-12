/**
 * The standard flow (req-266, the persona board concept §6): one key in
 * `tickets/_meta/pipeline.md`, the chain a new ticket gets copied in at
 * creation — `flow: paul:shape; paul; ben; ralf; tessa; you` (a YAML list
 * reads the same). Absent = no standard flow: a new ticket carries no chain.
 * An unreadable entry drops the whole key with a warning, never a guess.
 */
import type { ChainEntry } from '../contracts/chain';
import type { TicketIssue } from '../contracts/tickets';
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
