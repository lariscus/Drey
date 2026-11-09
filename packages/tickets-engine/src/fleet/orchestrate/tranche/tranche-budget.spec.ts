import { describe, expect, it } from 'vitest';
import { DEFAULT_TRANCHE, type TrancheConfig } from '../../protocol';
import { TrancheBudget } from './tranche-budget';
import { FakeClock, fact, record } from './tranche.fake';

const config = (over: Partial<TrancheConfig> = {}): TrancheConfig => ({ ...DEFAULT_TRANCHE, runs: null, budgetShare: null, minutes: null, ...over });

describe('TrancheBudget', () => {
  it('has room while no limit is reached', () => {
    const budget = new TrancheBudget({ limitUsd: () => 15 }, new FakeClock());
    expect(budget.exhaustedBy(record({ started: 3 }), config({ runs: 10, budgetShare: 0.33, minutes: 240 }))).toBeNull();
  });

  it('is spent by its runs: released ones count, not settled ones', () => {
    const budget = new TrancheBudget({ limitUsd: () => null }, new FakeClock());
    expect(budget.exhaustedBy(record({ started: 9 }), config({ runs: 10 }))).toBeNull();
    expect(budget.exhaustedBy(record({ started: 10 }), config({ runs: 10 }))).toBe('runs');
    expect(budget.runsLeft(record({ started: 4 }), config({ runs: 10 }))).toBe(6);
  });

  it("is spent by its share of the day's budget, over the settled runs' costs", () => {
    const budget = new TrancheBudget({ limitUsd: () => 15 }, new FakeClock());
    const share = config({ budgetShare: 1 / 3 });
    expect(budget.limits(record(), share).budget).toBe(5);
    expect(budget.exhaustedBy(record({ facts: [fact({ costUsd: 2 }), fact({ costUsd: 2.99 })] }), share)).toBeNull();
    expect(budget.exhaustedBy(record({ facts: [fact({ costUsd: 2 }), fact({ costUsd: 3 })] }), share)).toBe('budget');
  });

  it('has no budget limit while the day has no budget', () => {
    const budget = new TrancheBudget({ limitUsd: () => null }, new FakeClock());
    expect(budget.limits(record(), config({ budgetShare: 0.5 })).budget).toBeNull();
    expect(budget.exhaustedBy(record({ facts: [fact({ costUsd: 100 })] }), config({ budgetShare: 0.5 }))).toBeNull();
  });

  it('is spent by its time span on the wall clock from the release', () => {
    const clock = new FakeClock();
    const budget = new TrancheBudget({ limitUsd: () => null }, clock);
    const span = config({ minutes: 130 });
    expect(budget.limits(record(), span).endsAt).toBe('2026-11-09T14:10:00.000Z');
    clock.advance(129);
    expect(budget.exhaustedBy(record(), span)).toBeNull();
    clock.advance(1);
    expect(budget.exhaustedBy(record(), span)).toBe('time');
  });

  it('names the first limit reached when several are', () => {
    const clock = new FakeClock();
    clock.advance(300);
    const budget = new TrancheBudget({ limitUsd: () => 15 }, clock);
    expect(budget.exhaustedBy(record({ started: 10 }), config({ runs: 10, minutes: 60 }))).toBe('runs');
  });
});
