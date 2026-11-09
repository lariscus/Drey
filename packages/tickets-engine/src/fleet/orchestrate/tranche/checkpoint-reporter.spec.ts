import { describe, expect, it } from 'vitest';
import { CheckpointReporter } from './checkpoint-reporter';
import { fact, record } from './tranche.fake';
import type { TrancheCheckpoint } from './tranche-record';

const END: TrancheCheckpoint = { kind: 'end', at: '2026-11-09T14:10:00.000Z', endedBy: 'runs', earlyStop: null };

/** Board 10u part 1's sample: 10 runs, 7 of 8 green, +212 −40, $0.41 median · $1.20 max, T-0119 ran twice. */
const SAMPLE = [
  fact({ ticket: 'T-0119', gate: 'green', costUsd: 0.41, added: 212, removed: 40 }),
  fact({ ticket: 'T-0119', gate: 'red', costUsd: 1.2, added: 300, removed: 60 }),
  fact({ ticket: 'T-0120', gate: 'green', costUsd: 0.3, added: 150, removed: 30 }),
  fact({ ticket: 'T-0121', gate: 'green', costUsd: 0.45, added: 250, removed: 50 }),
  fact({ ticket: 'T-0122', gate: 'green', costUsd: 0.38, added: 180, removed: 10 }),
  fact({ ticket: 'T-0123', gate: 'green', costUsd: 0.5, added: 230, removed: 45 }),
  fact({ ticket: 'T-0124', gate: 'green', costUsd: 0.41, added: 212, removed: 40 }),
  fact({ ticket: 'T-0125', gate: 'green', costUsd: 0.2, added: 90, removed: 20 }),
  fact({ ticket: 'T-0126', gate: null, costUsd: 0.6, added: null, removed: null }),
];

describe('CheckpointReporter', () => {
  it("computes the board's four numbers from the run facts", () => {
    const report = new CheckpointReporter().report(record({ started: 10, facts: SAMPLE }), END);
    expect(report.gates).toEqual({ green: 7, total: 8 });
    expect(report.change).toEqual({ added: 212, removed: 40 });
    expect(report.cost).toEqual({ median: 0.41, max: 1.2 });
    expect(report.repeated).toEqual({ ticket: 'T-0119', runs: 2 });
    expect(report.runs).toBe(10);
    expect(report.spent).toBe(4.45);
    expect(report.minutes).toBe(130);
    expect(report).toMatchObject({ kind: 'end', endedBy: 'runs', earlyStop: null, at: END.at });
  });

  it('says nothing it does not know: no gates, no change, no cost, nothing repeated', () => {
    const report = new CheckpointReporter().report(record({ started: 1, facts: [fact({ gate: null, costUsd: null, added: null, removed: null })] }), END);
    expect(report.gates).toEqual({ green: 0, total: 0 });
    expect(report.change).toBeNull();
    expect(report.cost).toBeNull();
    expect(report.repeated).toBeNull();
  });

  it('takes the mean of the middle two on an even count', () => {
    const report = new CheckpointReporter().report(record({ facts: [fact({ costUsd: 0.2, added: 10, removed: 1 }), fact({ costUsd: 0.6, added: 30, removed: 3 })] }), END);
    expect(report.cost).toEqual({ median: 0.4, max: 0.6 });
    expect(report.change).toEqual({ added: 20, removed: 2 });
  });

  it('names the ticket that ran most often', () => {
    const facts = [fact({ ticket: 'A' }), fact({ ticket: 'B' }), fact({ ticket: 'B' }), fact({ ticket: 'A' }), fact({ ticket: 'B' })];
    expect(new CheckpointReporter().report(record({ facts }), END).repeated).toEqual({ ticket: 'B', runs: 3 });
  });
});
