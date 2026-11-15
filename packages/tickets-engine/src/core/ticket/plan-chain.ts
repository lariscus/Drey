/**
 * The plan's chain (req-266, the persona board concept §5): an optional
 * `### Chain` chapter under `## Plan` in which Paul writes the persona list
 * the ticket goes through — one line in the chain grammar
 * (core/chain-list.ts), the same text as `flow:` and a part's `chain:`:
 *
 *     ### Chain
 *
 *     paul:shape; paul; ben; ralf; tessa; you
 *
 * A list of `- <entry>` lines reads the same. The chapter is a proposal
 * inside the plan; the board service turns it into the ticket's `chain:`
 * when the plan is saved (`setPlan`), checked like every chain write.
 */
import type { ChainEntry } from '../../contracts/chain';
import { maskFences } from '../../../../../shared/markdown/fences';
import { chainItemsOf, parseChainItems, unreadableEntryMessage } from '../pipeline/chain-list';
import { planBounds } from '../plan/plan-parts';

export const CHAIN_HEADING = '### Chain';

export type PlanChain =
  | { readonly kind: 'none' }
  | { readonly kind: 'chain'; readonly entries: readonly ChainEntry[] }
  | { readonly kind: 'unreadable'; readonly error: string };

/** The `### Chain` chapter's body inside the Plan; null without one. */
function chainBody(text: string): string | null {
  const plan = planBounds(text);
  if (plan === null) {
    return null;
  }
  const masked = maskFences(text).slice(plan.start, plan.end);
  const heading = /^### Chain[ \t]*$/m.exec(masked);
  if (heading === null) {
    return null;
  }
  const from = heading.index + heading[0].length;
  const next = /^#{1,3} /m.exec(masked.slice(from));
  const to = next === null ? masked.length : from + next.index;
  return text.slice(plan.start + from, plan.start + to);
}

/** The plan's chain: none, the parsed list, or why it does not read. */
export function parsePlanChain(ticketText: string): PlanChain {
  const body = chainBody(ticketText.replace(/\r\n/g, '\n'));
  if (body === null) {
    return { kind: 'none' };
  }
  const lines = body
    .split('\n')
    .map((line) => line.trim().replace(/^[-*]\s+/, '').replace(/^`(.*)`$/, '$1'))
    .filter((line) => line !== '');
  const items = lines.flatMap((line) => chainItemsOf(line));
  if (items.length === 0) {
    return { kind: 'none' };
  }
  const parsed = parseChainItems(items);
  return parsed.ok ? { kind: 'chain', entries: parsed.entries } : { kind: 'unreadable', error: unreadableEntryMessage(parsed.bad) };
}
