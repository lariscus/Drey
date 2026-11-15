import { describe, expect, it } from 'vitest';
import type { HoldSpan } from '../../core/pipeline/hold-spans';
import { personaReport, positionReport } from './persona-report';
import type { ReportRun } from './report';

/** req-274: the report grouped by persona and by chain position. */

const MIN = 60_000;

const run = (over: Partial<ReportRun> = {}): ReportRun => ({
  ticketId: 'T-0001',
  phase: 'build',
  model: 'opus',
  provider: 'claude-code',
  usage: { input: 100, cacheRead: null, cacheCreation: null, output: 10 },
  tokensIn: 0,
  tokensOut: 0,
  tokensBeforeFirstWrite: null,
  ...over,
});

const span = (persona: string, position: number | null, ms: number, ticket = 'T-0001'): HoldSpan => ({
  ticket,
  persona,
  position,
  length: position === null ? null : 4,
  from: '2026-11-13T09:00:00Z',
  to: null,
  ms,
});

describe('personaReport', () => {
  it('adds the red gates and the time held to each persona’s cost row', () => {
    const rows = personaReport(
      [run({ persona: 'ben', costUsd: 0.4, gate: 'red' }), run({ persona: 'ben', costUsd: 0.1, gate: 'green' }), run({ persona: 'tessa', gate: null })],
      [span('ben', 2, 30 * MIN), span('ben', 2, 10 * MIN, 'T-0002')],
    );
    const ben = rows.find((r) => r.persona === 'ben')!;
    expect(ben).toMatchObject({ runs: 2, costUsd: 0.5, redGates: 1, heldMs: 40 * MIN });
    expect(rows.find((r) => r.persona === 'tessa')).toMatchObject({ runs: 1, redGates: 0, heldMs: null });
  });

  it('a persona that only held tickets has a row with no runs', () => {
    const rows = personaReport([run({ persona: 'ben' })], [span('you', 4, 90 * MIN), span('pia', 1, 5 * MIN)]);
    expect(rows.map((r) => r.persona)).toEqual(['ben', 'you', 'pia']);
    expect(rows[1]).toMatchObject({ persona: 'you', runs: 0, total: 0, costUsd: null, redGates: 0, heldMs: 90 * MIN });
  });

  it('is empty without runs and holds', () => {
    expect(personaReport([], [])).toEqual([]);
  });
});

describe('positionReport', () => {
  it('sums runs, cost and busy time per position; waiting is held minus busy', () => {
    const rows = positionReport(
      [run({ position: 1, costUsd: 0.2, busyMs: 10 * MIN }), run({ position: 1, costUsd: null, busyMs: 5 * MIN }), run({ position: 2, busyMs: 20 * MIN })],
      [span('paul', 1, 60 * MIN), span('ben', 2, 15 * MIN)],
    );
    expect(rows).toEqual([
      { position: 1, runs: 2, costUsd: 0.2, busyMs: 15 * MIN, heldMs: 60 * MIN, waitingMs: 45 * MIN },
      { position: 2, runs: 1, costUsd: null, busyMs: 20 * MIN, heldMs: 15 * MIN, waitingMs: 0 },
    ]);
  });

  it('a position only held, or only run, says what it knows and nothing more', () => {
    const rows = positionReport([run({ position: 3, busyMs: null })], [span('you', 4, 30 * MIN), span('you', null, 99 * MIN)]);
    expect(rows).toEqual([
      { position: 3, runs: 1, costUsd: null, busyMs: null, heldMs: null, waitingMs: null },
      { position: 4, runs: 0, costUsd: null, busyMs: null, heldMs: 30 * MIN, waitingMs: null },
    ]);
  });

  it('runs outside a chain are not in the position rows', () => {
    expect(positionReport([run({ position: null }), run({})], [])).toEqual([]);
  });
});
