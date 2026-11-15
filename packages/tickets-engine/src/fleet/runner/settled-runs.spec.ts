import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainHarness } from '../chain/chain-harness.fake';

/**
 * A run settled (M85, E7): the ledger lines (`dispatched`, `run_settled`)
 * and the holds a blocked end or the owner's stop leave. The status comment
 * of the end is the run's own release (E14-6) — the chain writes none, so
 * a settle leaves the store untouched. Through the real composition over a
 * fake dricket store.
 */

let h: ChainHarness;

describe('SettledRuns', () => {
  beforeEach(async () => {
    h = new ChainHarness();
    await h.setUp();
  });

  afterEach(async () => {
    await h.tearDown();
  });

  it('a run that ends done but blocked holds its ticket — no re-dispatch into the same wall', async () => {
    h.seedRun('T-0001');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records).toHaveLength(1);

    const before = h.io.textOf('T-0001');
    await orch.onRunSettled(fleet.end(fleet.records[0]!, { state: 'done', blocked: 'merge conflict in specs/changelog.md' }));

    // The ticket waits for the owner: a pass triggered afresh (the
    // master flip) must not dispatch it again.
    await orch.setMaster('halted');
    await orch.setMaster('run');
    expect(fleet.records).toHaveLength(1); // held like an owner-stopped run
    expect(h.io.comments).toEqual([]); // the blocked comment is the run's own release, not the chain's
    expect(h.io.textOf('T-0001')).toBe(before);
  });

  it('a run the owner stopped is not re-dispatched while the ticket stays where it is', async () => {
    h.seedRun('T-0001');
    const { orch, fleet } = h.build({ now: () => new Date('2026-10-18T12:00:00Z') });
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records).toHaveLength(1);

    await orch.onRunSettled(fleet.end(fleet.records[0]!, { state: 'stopped' }));
    await orch.setMaster('halted');
    await orch.setMaster('run');
    expect(fleet.records).toHaveLength(1);
  });

  describe('the E7 ledger', () => {
    it('a dispatch writes the ledger dispatched line', async () => {
      h.seedRun('T-0001');
      const events = { ledger: vi.fn() };
      const { orch, fleet } = h.build({ events });
      await orch.configure(h.config());
      await orch.setMaster('run');

      expect(fleet.records).toHaveLength(1);
      const lines = events.ledger.mock.calls.map(([line]) => line as { readonly kind: string });
      expect(lines.filter((line) => line.kind === 'dispatched')).toHaveLength(1); // the holder pass also writes its own hold line (req-274)
      expect(events.ledger).toHaveBeenCalledWith({ kind: 'dispatched', ticket: 'T-0001', persona: 'ben', model: 'opus' });
    });

    it('a settled run with usage writes the run_settled ledger line; an empty one writes nothing', async () => {
      h.seedRun('T-0001');
      const events = { ledger: vi.fn() };
      const { orch, fleet } = h.build({ events });
      await orch.configure(h.config());
      await orch.setMaster('run');
      await orch.setMaster('halted');

      const record = fleet.records[0]!;
      // The effective cost rides along (the price-table fallback ran at
      // the settle); a zero-usage run stays off the ledger entirely.
      await orch.onRunSettled({ ...record.info, state: 'done', persona: 'pia', model: 'opus', tokensIn: 48_000, tokensOut: 6_000, costUsd: 1.17 });
      expect(events.ledger).toHaveBeenLastCalledWith({ kind: 'run_settled', ticket: 'T-0001', persona: 'pia', model: 'opus', tokensIn: 48_000, tokensOut: 6_000, cost: 1.17 });

      const callsBefore = events.ledger.mock.calls.length;
      await orch.onRunSettled({ ...record.info, state: 'failed', tokensIn: 0, tokensOut: 0, costUsd: null });
      expect(events.ledger).toHaveBeenCalledTimes(callsBefore);
    });
  });
});
