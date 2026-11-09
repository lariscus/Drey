import { describe, expect, it } from 'vitest';
import { TrancheLedger } from './tranche-ledger';
import { restoreTranche, type TrancheRecord } from './tranche-record';
import { FakeClock, fact, record } from './tranche.fake';

function ledger(start: TrancheRecord | null = null): { ledger: TrancheLedger; state: { tranche: TrancheRecord | null }; clock: FakeClock } {
  const state = { tranche: start };
  const clock = new FakeClock();
  return { ledger: new TrancheLedger(state, clock), state, clock };
}

describe('TrancheLedger', () => {
  it('opens tranche 1, then the next on the same day, and 1 again on a new day', () => {
    const { ledger: l, clock } = ledger();
    expect(l.open()).toMatchObject({ index: 1, day: '2026-11-09', started: 0, startedAt: '2026-11-09T12:00:00.000Z' });
    expect(l.open().index).toBe(2);
    clock.advance(24 * 60);
    expect(l.open()).toMatchObject({ index: 1, day: '2026-11-10' });
  });

  it('counts a start and turns the settle of a started ticket into a fact', () => {
    const { ledger: l, state } = ledger(record());
    l.started('T-0100');
    expect(state.tranche).toMatchObject({ started: 1, pending: ['T-0100'] });
    expect(l.settled(fact({ ticket: 'T-0100' }))).toBe(true);
    expect(state.tranche?.facts).toHaveLength(1);
    expect(state.tranche?.pending).toEqual([]);
  });

  it('ignores a run it did not release (a run the owner started by hand)', () => {
    const { ledger: l, state } = ledger(record());
    expect(l.settled(fact({ ticket: 'T-0999' }))).toBe(false);
    expect(state.tranche?.facts).toEqual([]);
  });

  it('carries the runs still out into the next tranche', () => {
    const { ledger: l, state } = ledger(record({ started: 2, pending: ['T-0101'] }));
    l.open();
    expect(state.tranche).toMatchObject({ index: 2, started: 0, pending: ['T-0101'] });
  });

  it('raises a checkpoint and goes on past an early stop', () => {
    const { ledger: l, state } = ledger(record({ facts: [fact(), fact()] }));
    l.raise({ kind: 'early', at: '2026-11-09T13:00:00.000Z', endedBy: null, earlyStop: null });
    expect(state.tranche?.checkpoint?.kind).toBe('early');
    l.continueAfterEarlyStop();
    expect(state.tranche).toMatchObject({ checkpoint: null, anomalyFrom: 2 });
  });

  it('keeps its counters through chain.json (a restart continues the same tranche)', () => {
    const { ledger: l, state } = ledger(record({ index: 4 }));
    l.started('T-0100');
    l.settled(fact({ ticket: 'T-0100', costUsd: 1.25 }));
    l.started('T-0101');
    l.raise({ kind: 'end', at: '2026-11-09T14:00:00.000Z', endedBy: 'runs', earlyStop: null });
    const restored = restoreTranche(JSON.parse(JSON.stringify(state.tranche)));
    expect(restored).toEqual(state.tranche);
  });
});

describe('restoreTranche', () => {
  it('reads nothing from a missing or torn record', () => {
    expect(restoreTranche(undefined)).toBeNull();
    expect(restoreTranche({ index: 'x' })).toBeNull();
    expect(restoreTranche({ index: 1, day: '2026-11-09', startedAt: 'not a time' })).toBeNull();
  });

  it('drops a broken fact and keeps the rest', () => {
    const restored = restoreTranche({ ...record(), facts: [fact(), { runId: 7 }], anomalyFrom: 9 });
    expect(restored?.facts).toHaveLength(1);
    expect(restored?.anomalyFrom).toBe(1);
  });
});
