import type { SlotBilling } from '../protocol';
import { UNTABLED_COST } from './model-table';
import type { RouteCandidate } from './route-candidate';

/** A slot whose surplus no window can tell ranks as one spending at an even pace. */
export const NEUTRAL_Q = 1;

const priceOf = (billing: SlotBilling | null): number => {
  const price = billing === null ? null : billing.kind === 'subscription' ? billing.pricePerMonth : billing.kind === 'credits' ? billing.pricePerCredit : billing.pricePerMillion;
  return price ?? Number.POSITIVE_INFINITY;
};

/**
 * The routing's soft choice (req-178, ADR-0095 later change) among the
 * candidates the filter left — all of the class granted: the slot a resumed
 * session lives on first (its session can only continue there), then the
 * largest surplus `q`, then the cheaper (the row's cost factor, then the
 * slot's price), then the pool's order. Never a choice of class: every
 * candidate already is the class asked for.
 */
export class SurplusChoice {
  /** The best candidate; null when there is none. */
  pick(candidates: readonly RouteCandidate[], prefer: string | null): RouteCandidate | null {
    const preferred = prefer === null ? [] : candidates.filter((c) => c.view.id === prefer);
    return [...(preferred.length > 0 ? preferred : candidates)].sort((a, b) => this.compare(a, b))[0] ?? null;
  }

  private compare(a: RouteCandidate, b: RouteCandidate): number {
    const q = (b.view.q ?? NEUTRAL_Q) - (a.view.q ?? NEUTRAL_Q);
    if (Math.abs(q) > 1e-9) {
      return q;
    }
    const cost = (a.row?.cost ?? UNTABLED_COST) - (b.row?.cost ?? UNTABLED_COST);
    if (Math.abs(cost) > 1e-9) {
      return cost;
    }
    const price = priceOf(a.view.billing) - priceOf(b.view.billing);
    return Number.isNaN(price) || price === 0 ? a.order - b.order : price;
  }
}
