import { describe, expect, it } from 'vitest';
import type { ModelRow, SlotBilling, SlotView } from '../protocol';
import type { RouteCandidate } from './route-candidate';
import { SurplusChoice } from './surplus-choice';

const view = (id: string, q: number | null, billing: SlotBilling | null = null): SlotView =>
  ({ id, label: id, provider: 'claude-code', billing, quota: 'counting', state: 'ready', busy: 0, total: null, windows: [], q, reason: null, lastFetch: null, lastFetchError: null, implied: false }) as SlotView;
const row = (model: string, cost: number): ModelRow => ({ model, slot: null, provider: 'claude-code', category: '', class: 'standard', cost, enabled: true });
const cand = (id: string, q: number | null, cost: number, order: number, billing: SlotBilling | null = null): RouteCandidate => ({
  row: row(`m-${id}`, cost),
  entry: { provider: null, model: `m-${id}` },
  provider: 'claude-code',
  view: view(id, q, billing),
  order,
});
const month = (price: number): SlotBilling => ({ kind: 'subscription', pricePerMonth: price });

describe('SurplusChoice — the largest surplus, then the cheaper (req-178)', () => {
  it.each<[string, RouteCandidate[], string | null, string]>([
    ['the largest q wins over a cheaper slot', [cand('a', 1.1, 0.4, 0), cand('b', 1.5, 1, 1)], null, 'b'],
    ['same q → the cheaper cost factor', [cand('a', 1.2, 1, 0), cand('b', 1.2, 0.4, 1)], null, 'b'],
    ['same q and cost → the cheaper slot price', [cand('a', 1.2, 1, 0, month(200)), cand('b', 1.2, 1, 1, month(20))], null, 'b'],
    ['a price beats no price', [cand('a', 1.2, 1, 0), cand('b', 1.2, 1, 1, month(20))], null, 'b'],
    ['all equal → the pool order', [cand('a', 1, 1, 1), cand('b', 1, 1, 0)], null, 'b'],
    ['an unknown q ranks as an even pace (1)', [cand('a', null, 0.4, 0), cand('b', 0.9, 0.4, 1)], null, 'a'],
    ['an unknown q loses to a surplus', [cand('a', null, 0.4, 0), cand('b', 1.1, 1, 1)], null, 'b'],
    ["the resumed session's slot first, whatever its q", [cand('a', 0.5, 1, 0), cand('b', 1.8, 0.4, 1)], 'a', 'a'],
    ['a preferred slot that did not pass the filter is not there: surplus decides', [cand('a', 0.5, 1, 0), cand('b', 1.8, 0.4, 1)], 'gone', 'b'],
  ])('%s', (_name, candidates, prefer, expected) => {
    expect(new SurplusChoice().pick(candidates, prefer)?.view.id).toBe(expected);
  });

  it('nothing to choose from → null', () => {
    expect(new SurplusChoice().pick([], null)).toBeNull();
  });
});
