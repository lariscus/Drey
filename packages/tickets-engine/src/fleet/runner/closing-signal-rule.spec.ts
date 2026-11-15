import { describe, expect, it } from 'vitest';
import type { RunInfo, RunRequest } from '../protocol';
import { ClosingSignalRule, COST_OUTLIER_MIN_RUNS, isCostOutlier, typicalCost } from './closing-signal-rule';
import { newLiveRun, type LiveRun } from './live-run';
import { RecordedRunCosts } from '../telemetry/recorded-run-costs';
import { runInfo, runRequest } from './supervisor-harness.fake';

function run(info: Partial<RunInfo> = {}, request: Partial<RunRequest> = {}, friction: string | null = null): LiveRun {
  const live = newLiveRun({ info: runInfo({ id: 'r-now', persona: 'ben', costUsd: 0.5, ...info }), request: runRequest('V:/vault', request), dir: 'F:/runs/r-now' });
  live.friction = friction;
  return live;
}

const costs = (values: number[]): RecordedRunCosts =>
  new RecordedRunCosts(() => values.map((costUsd, i) => runInfo({ id: `r-${i}`, persona: 'ben', state: 'done', costUsd })));

describe('the cost outlier (req-169)', () => {
  it('typical is the median of the last runs, null below the minimum sample', () => {
    expect(typicalCost([1, 2, 3, 4])).toBeNull();
    expect(typicalCost([1, 9, 2, 3, 2])).toBe(2);
    expect(typicalCost([1, 2, 3, 4, 5, 6])).toBe(3.5);
    expect(COST_OUTLIER_MIN_RUNS).toBe(5);
  });

  it('only far above typical counts: more than three times the median', () => {
    expect(isCostOutlier(3, 1)).toBe(false);
    expect(isCostOutlier(3.01, 1)).toBe(true);
    expect(isCostOutlier(9, null)).toBe(false);
    expect(isCostOutlier(null, 1)).toBe(false);
  });

  it("the runner's records give the history: settled ticket runs of the persona with a cost, never the run itself", () => {
    const records = new RecordedRunCosts(() => [
      runInfo({ id: 'a', persona: 'ben', state: 'done', costUsd: 1 }),
      runInfo({ id: 'b', persona: 'ben', state: 'stopped', costUsd: 2 }),
      runInfo({ id: 'c', persona: 'pia', state: 'done', costUsd: 3 }),
      runInfo({ id: 'd', persona: 'ben', state: 'failed', costUsd: null }),
      runInfo({ id: 'e', persona: 'ben', state: 'done', costUsd: 5, kind: '1:1' }),
      runInfo({ id: 'r-now', persona: 'ben', state: 'done', costUsd: 9 }),
    ]);
    expect(records.costsOf('ben', 'r-now')).toEqual([1]);
  });
});

describe('ClosingSignalRule (req-169)', () => {
  const rule = new ClosingSignalRule(costs([0.5, 0.4, 0.6, 0.5, 0.5]));

  it('a smooth run raises nothing', () => {
    expect(rule.assess(run({ gateResult: 'green' })).signals).toEqual([]);
  });

  it('raises each of the five', () => {
    const all = rule.assess(run({ gateResult: 'red', steerCount: 1, costUsd: 2 }, { closing: { signals: ['red-gate', 'retry', 'steer', 'cost', 'friction'], retry: true } }, 'lacked the schema'));
    expect(all).toEqual({ signals: ['red-gate', 'retry', 'steer', 'cost', 'friction'], costUsd: 2, typicalCostUsd: 0.5 });
  });

  it('asks only for the signals the vault lists', () => {
    expect(rule.assess(run({ gateResult: 'red', steerCount: 3 }, { closing: { signals: ['steer'], retry: false } })).signals).toEqual(['steer']);
  });

  it("a run without the provider's cost is judged on the price table's estimate", () => {
    const estimate = rule.assess(run({ costUsd: null, model: 'opus', tokensIn: 2_000_000, tokensOut: 100_000 }));
    expect(estimate.costUsd).not.toBeNull();
    expect(estimate.signals).toEqual(['cost']);
  });
});
