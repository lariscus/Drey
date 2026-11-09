import { describe, expect, it } from 'vitest';
import { journalByModel } from './journal-report';
import type { JournalEntry } from './persona-journal';

function entry(over: Partial<JournalEntry>): JournalEntry {
  return { at: '2026-11-09T10:00:00Z', ticket: 'T-0102', persona: 'ben', harness: 'claude-code', model: 'sonnet', gate: 'green', costUsd: null, signals: [], friction: null, finding: null, note: null, ...over };
}

describe('journalByModel — would another model do better (req-169)', () => {
  it('groups by harness/model with the runs, red gates, retries, steers, outliers, mean cost and causes', () => {
    const report = journalByModel([
      entry({ gate: 'red', signals: ['red-gate', 'retry'], costUsd: 1, finding: { cause: 'model', text: 'lost the thread' }, friction: 'old friction', at: '2026-11-08T10:00:00Z' }),
      entry({ persona: 'pia', signals: ['steer', 'cost'], costUsd: 3, finding: { cause: 'prompt', text: 'x' }, friction: 'new friction' }),
      entry({ harness: 'opencode', model: 'qwen', signals: ['friction'], friction: 'one' }),
      entry({ harness: null, model: null, gate: 'none', signals: ['friction'], friction: 'migrated' }),
    ]);
    expect(report.map((r) => r.model)).toEqual(['claude-code/sonnet', 'opencode/qwen', 'unknown']);
    expect(report[0]).toEqual({
      model: 'claude-code/sonnet',
      runs: 2,
      redGates: 1,
      retries: 1,
      steers: 1,
      costOutliers: 1,
      meanCostUsd: 2,
      causes: { model: 1, prompt: 1, task: 0, environment: 0 },
      personas: ['ben', 'pia'],
      frictions: ['new friction', 'old friction'],
    });
    expect(report[1]).toMatchObject({ runs: 1, meanCostUsd: null, frictions: ['one'] });
  });

  it('an empty journal is an empty report', () => {
    expect(journalByModel([])).toEqual([]);
  });
});
