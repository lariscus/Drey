/**
 * The chain's three ticket fields as the reader sees them (req-266):
 * `chain:` the ordered persona list, `at:` the cursor, `sent-back:` the one
 * send-back. A chain with an unreadable entry is read as no chain — every
 * later position would shift — with a warning, except on a done ticket,
 * whose old chain-delta text stays as history (concept §12 step 7).
 */
import type { ChainEntry, ChainSendBack, TicketChainFields } from '../../contracts/chain';
import type { TicketIssue } from '../../contracts/tickets';
import { chainItemsOf, parseChainItems, parseSendBack, unreadableEntryMessage } from '../pipeline/chain-list';

export type { TicketChainFields };

function cursorOf(raw: unknown): number | null {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
  return Number.isInteger(value) && value >= 1 ? value : null;
}

/** req-78: the red-gate loop's two fields, `return-to:` (a position) and `red-backs:` (a count); junk is a warning and absent. */
function redLoopOf(header: Readonly<Record<string, unknown>>, issues: TicketIssue[]): { returnTo?: number; redBacks?: number } {
  const out: { returnTo?: number; redBacks?: number } = {};
  for (const [key, field] of [['return-to', 'returnTo'], ['red-backs', 'redBacks']] as const) {
    const raw = header[key];
    if (raw === undefined || raw === null) {
      continue;
    }
    const value = cursorOf(raw);
    if (value === null) {
      issues.push({ level: 'warning', message: `${key} must be a whole number from 1 — ignored` });
    } else {
      out[field] = value;
    }
  }
  return out;
}

/** The chain fields of a parsed frontmatter object; findings go to `issues`. */
export function parseTicketChainFields(header: Readonly<Record<string, unknown>>, issues: TicketIssue[], done: boolean): TicketChainFields {
  const items = chainItemsOf(header['chain']);
  const parsed = parseChainItems(items);
  if (!parsed.ok) {
    if (!done) {
      issues.push({ level: 'warning', message: `${unreadableEntryMessage(parsed.bad)} — the chain is read as absent` });
    }
    return {};
  }
  if (parsed.entries.length === 0) {
    return {};
  }
  const out: { chain: readonly ChainEntry[]; at?: number; sentBack?: ChainSendBack; returnTo?: number; redBacks?: number } = { chain: parsed.entries, ...redLoopOf(header, issues) };
  const rawAt = header['at'];
  if (rawAt !== undefined && rawAt !== null) {
    const at = cursorOf(rawAt);
    if (at === null) {
      issues.push({ level: 'warning', message: 'at must be a position of the chain (1, 2, …) — read as 1' });
    } else if (at > parsed.entries.length) {
      issues.push({ level: 'warning', message: `at ${at} is past the chain's ${parsed.entries.length} entries` });
      out.at = at;
    } else {
      out.at = at;
    }
  }
  const rawSentBack = header['sent-back'];
  if (rawSentBack !== undefined && rawSentBack !== null) {
    const sentBack = parseSendBack(rawSentBack);
    if (sentBack === null) {
      issues.push({ level: 'warning', message: 'sent-back must read <from>><to>, e.g. 5>3 — ignored' });
    } else {
      out.sentBack = sentBack;
    }
  }
  return out;
}
