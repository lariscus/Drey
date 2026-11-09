import { describe, expect, it } from 'vitest';
import { DEFAULT_EARLY_STOP, type EarlyStopConfig } from '../../protocol';
import { AnomalyDetector } from './anomaly-detector';
import { fact } from './tranche.fake';
import type { RunFact } from './tranche-record';

const OFF: EarlyStopConfig = { redGates: null, gateWindow: 6, sameTicketRed: null, changeFactor: null, costFactor: null, minRuns: 3 };
const check = (facts: RunFact[], config: Partial<EarlyStopConfig>, runsLeft: number | null = 6) => new AnomalyDetector().check({ facts, runsLeft }, { ...OFF, ...config });

describe('AnomalyDetector', () => {
  describe('a falling gate rate', () => {
    const rule = { redGates: 3, gateWindow: 6 };

    it('fires with three red among the last six gates (board 10u part 6)', () => {
      const facts = [
        fact({ ticket: 'T-0119', gate: 'red' }),
        fact({ ticket: 'T-0120' }),
        fact({ ticket: 'T-0119', gate: 'red' }),
        fact({ ticket: 'T-0121' }),
        fact({ ticket: 'T-0122' }),
        fact({ ticket: 'T-0124', gate: 'red', phase: 'test', persona: 'tessa' }),
      ];
      const stop = check(facts, rule);
      expect(stop).toMatchObject({ rule: 'gate_rate', red: 3, window: 6, runsLeft: 6 });
      expect(stop?.tickets).toEqual([
        { ticket: 'T-0124', phase: 'test', persona: 'tessa', red: 1 },
        { ticket: 'T-0119', phase: 'build', persona: 'ben', red: 2 },
      ]);
    });

    it('does not fire with two red, nor when the newest gate is green', () => {
      expect(check([fact({ gate: 'red' }), fact(), fact({ gate: 'red', ticket: 'B' })], rule)).toBeNull();
      expect(check([fact({ gate: 'red', ticket: 'A' }), fact({ gate: 'red', ticket: 'B' }), fact({ gate: 'red', ticket: 'C' }), fact()], rule)).toBeNull();
    });

    it('looks only at the window: old reds fall out', () => {
      const old = [fact({ gate: 'red', ticket: 'A' }), fact({ gate: 'red', ticket: 'B' })];
      expect(check([...old, fact(), fact(), fact(), fact(), fact(), fact({ gate: 'red', ticket: 'C' })], rule)).toBeNull();
    });

    it('skips runs without a gate', () => {
      expect(check([fact({ gate: 'red', ticket: 'A' }), fact({ gate: null }), fact({ gate: 'red', ticket: 'B' }), fact({ gate: 'red', ticket: 'C' })], rule)).toMatchObject({ red: 3, window: 3 });
    });
  });

  describe('the same ticket red again', () => {
    it('fires when one ticket is red twice', () => {
      const stop = check([fact({ ticket: 'T-0119', gate: 'red' }), fact({ ticket: 'T-0120' }), fact({ ticket: 'T-0119', gate: 'red' })], { sameTicketRed: 2 });
      expect(stop).toMatchObject({ rule: 'same_ticket', red: 2, ticket: 'T-0119' });
      expect(stop?.tickets).toEqual([{ ticket: 'T-0119', phase: 'build', persona: 'ben', red: 2 }]);
    });

    it('does not fire for two different red tickets', () => {
      expect(check([fact({ ticket: 'A', gate: 'red' }), fact({ ticket: 'B', gate: 'red' })], { sameTicketRed: 2 })).toBeNull();
    });
  });

  describe('a growing change', () => {
    it("fires when a run's change is far above the median of the runs before it", () => {
      const facts = [fact({ added: 100, removed: 20 }), fact({ added: 90, removed: 30 }), fact({ added: 110, removed: 10 }), fact({ ticket: 'T-0130', added: 500, removed: 100 })];
      expect(check(facts, { changeFactor: 3 })).toMatchObject({ rule: 'change_growth', ticket: 'T-0130', value: 600, median: 120 });
    });

    it('does not fire below the factor or before enough runs', () => {
      expect(check([fact(), fact(), fact(), fact({ added: 300, removed: 50 })], { changeFactor: 3 })).toBeNull();
      expect(check([fact(), fact(), fact({ added: 5000, removed: 0 })], { changeFactor: 3 })).toBeNull();
    });
  });

  describe('a dear run', () => {
    it("fires when a run's cost is far above the median", () => {
      const facts = [fact({ costUsd: 0.4 }), fact({ costUsd: 0.5 }), fact({ costUsd: 0.3 }), fact({ ticket: 'T-0131', costUsd: 2 })];
      expect(check(facts, { costFactor: 3 })).toMatchObject({ rule: 'cost_outlier', ticket: 'T-0131', value: 2, median: 0.4 });
    });

    it('does not fire at the factor or without a cost', () => {
      expect(check([fact({ costUsd: 0.4 }), fact({ costUsd: 0.4 }), fact({ costUsd: 0.4 }), fact({ costUsd: 1.2 })], { costFactor: 3 })).toBeNull();
      expect(check([fact(), fact(), fact(), fact({ costUsd: null })], { costFactor: 3 })).toBeNull();
    });
  });

  it('fires nothing with every rule off, and the defaults stop a red streak', () => {
    const reds = [fact({ ticket: 'A', gate: 'red' }), fact({ ticket: 'B', gate: 'red' }), fact({ ticket: 'C', gate: 'red' })];
    expect(check(reds, {})).toBeNull();
    expect(new AnomalyDetector().check({ facts: reds, runsLeft: null }, DEFAULT_EARLY_STOP)).toMatchObject({ rule: 'gate_rate', runsLeft: null });
  });
});
