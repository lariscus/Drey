import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChainHarness, PIPELINE } from './orchestrate/chain-harness.fake';
import type { ChainConfig } from './protocol';

/**
 * The chain orchestrator's surface (M85, ADR-0096): the control API, the
 * persistence in `chain.json`, Notaus and the column brake, the settle hook
 * and the persona pause — through `composeOrchestrator` over a fake dricket
 * store and a fake supervisor port. The parts have their own specs beside
 * them in `orchestrate/`.
 */

let h: ChainHarness;

describe('Orchestrator', () => {
  beforeEach(async () => {
    h = new ChainHarness();
    await h.setUp();
  });

  afterEach(async () => {
    await h.tearDown();
  });

  it('Notaus aborts every live run and halts the chain', async () => {
    h.seedRun('T-0001');
    h.seedRun('T-0002');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    const status = await orch.setMaster('run');
    expect(status.master).toBe('run');
    expect(fleet.records).toHaveLength(2);

    const after = await orch.abortAll();
    expect(after.master).toBe('halted');
    expect(fleet.stop).toHaveBeenCalledTimes(2);
    expect(orch.status().master).toBe('halted');
  });

  it('stopping a column aborts its live runs and marks the column held', async () => {
    h.seedRun('T-0001');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records).toHaveLength(1);
    expect(fleet.records[0]!.request.column).toBe('active');
    const runId = fleet.records[0]!.info.id;

    await orch.stopColumn('active');
    expect(fleet.stop).toHaveBeenCalledWith(runId, 'column active stopped');
    expect(orch.status().columns['active']).toBe('held');
  });

  it('stopping another column aborts no run of this one', async () => {
    h.seedRun('T-0001');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');

    await orch.stopColumn('prioritized');
    expect(fleet.stop).not.toHaveBeenCalled();
    expect(orch.status().columns['prioritized']).toBe('held');
  });

  it('persists column state in chain.json, but the master always boots halted', async () => {
    h.seedRun('T-0001');
    const first = h.build();
    await first.orch.configure(h.config());
    await first.orch.setMaster('run');
    await first.orch.setColumn('prioritized', 'held');
    first.orch.dispose();

    const second = h.build();
    await second.orch.load();
    const status = second.orch.status();
    expect(status.configured).toBe(true);
    // "An" is a per-session decision: the persisted master never resumes.
    expect(status.master).toBe('halted');
    expect(status.columns['prioritized']).toBe('held');
    // Halted means: no dispatch on boot either.
    expect(second.fleet.records).toEqual([]);
    // The owner's session: An, then the dispatch runs again.
    await second.orch.setMaster('run');
    expect(second.fleet.records).toHaveLength(1);
  });

  it('drops the control state of phases the pipeline no longer has', async () => {
    const withParking = PIPELINE.replace('  - { id: done,', '  - { id: parking, title: Parking, handover: manual }\n  - { id: done,');
    await h.write('tickets/_meta/pipeline.md', withParking);
    const first = h.build();
    await first.orch.configure(h.config());
    await first.orch.setMaster('run');
    await first.orch.setColumn('parking', 'held');
    await first.orch.setColumn('prioritized', 'held');
    first.orch.dispose();

    // The owner removes the parking column from the pipeline.
    await h.write('tickets/_meta/pipeline.md', PIPELINE);

    const second = h.build();
    await second.orch.load();
    // Loaded — the stale key survives until a pass has read the pipeline.
    expect(second.orch.status().columns['parking']).toBe('held');
    await second.orch.configure(h.config());
    const status = second.orch.status();
    expect(status.columns['parking']).toBeUndefined();
    const chain = (await h.chainFile()) as { columns: Record<string, string> };
    expect(chain.columns['parking']).toBeUndefined();
    // A phase the pipeline still has keeps its state.
    expect(status.columns['prioritized']).toBe('held');
  });

  it('a handover to a newer build is no new session: the successor keeps the master running', async () => {
    let current = new Date('2026-10-31T15:04:18Z');
    const first = h.build({ now: () => current });
    await first.orch.configure(h.config());
    await first.orch.setMaster('run');
    await first.orch.markHandover();
    first.orch.dispose();

    const second = h.build({ now: () => current });
    await second.orch.load();
    expect(second.orch.status().master).toBe('run');
    second.orch.dispose();

    // The stamp is spent: a later cold boot starts halted again.
    current = new Date(current.getTime() + 60_000);
    const third = h.build({ now: () => current });
    await third.orch.load();
    expect(third.orch.status().master).toBe('halted');
  });

  it('a run-settled hook triggers a fresh pass (the slot feeds the next ticket)', async () => {
    h.seedRun('T-0001');
    h.seedRun('T-0002');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records).toHaveLength(2);
    await orch.setMaster('halted');

    // T-0003 arrives externally; a settle (its ticket moved on) fires the pass that takes it.
    h.seedRun('T-0003');
    await orch.setMaster('run');
    expect(fleet.records).toHaveLength(2); // both slots are taken
    h.io.move('T-0001', 'done');
    await orch.onRunSettled(fleet.end(fleet.records[0]!, { state: 'done' }));
    expect(fleet.records.map((r) => r.request.ticketId)).toEqual(['T-0001', 'T-0002', 'T-0003']);
  });

  it('the lease reaper is reachable through the ports', async () => {
    const { orch, fleet } = h.build();
    await orch.reapAll();
    expect(fleet.port.reap).toHaveBeenCalled();
  });

  it('a chain config without a store dispatches nothing and says so once (req-176)', async () => {
    h.seedRun('T-0001');
    const { orch, fleet, logs } = h.build();
    const { ticketsVaultPath, git, defaultWorker, permissionMode, pools } = h.config();
    const noStore: ChainConfig = { ticketsVaultPath, git, defaultWorker, permissionMode, ...(pools !== undefined ? { pools } : {}) };
    await orch.configure(noStore);
    await orch.setMaster('run');
    await orch.setMaster('halted');
    await orch.setMaster('run');

    expect(fleet.records).toEqual([]);
    expect(orch.onStore()).toBe(false);
    const said = logs.filter((line) => line.includes('dricket store only'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('nothing is dispatched');
  });

  describe('the persona pause (U4)', () => {
    it('a paused persona holds its tickets until it is played again', async () => {
      await h.writePersona('pia', { worker: 'claude-code', model: 'sonnet' });
      h.seedRun('T-0110', { persona: 'pia' }); // the paused persona's ticket
      h.seedRun('T-0111'); // Ben's — not Pia's business
      const { orch, fleet, logs } = h.build();
      await orch.configure(h.config());
      await orch.setPersonaPaused('pia', true);
      await orch.setMaster('run');

      expect(fleet.records.some((r) => r.info.ticketId === 'T-0110')).toBe(false);
      expect(logs.some((line) => line.includes('dispatch holds T-0110: persona "pia" is paused'))).toBe(true);
      expect(orch.status().pausedPersonas).toEqual(['pia']);
      // persisted in chain.json like every control state
      expect((await h.chainFile())['pausedPersonas']).toEqual(['pia']);
      // Ben's ticket dispatches normally while pia is paused
      expect(fleet.records.some((r) => r.info.ticketId === 'T-0111')).toBe(true);
      // played again → the held ticket dispatches on the next pass
      const status = await orch.setPersonaPaused('pia', false);
      expect(status.pausedPersonas).toEqual([]);
      expect(fleet.records.some((r) => r.info.ticketId === 'T-0110')).toBe(true);
    });

    it('the pause survives a runner restart (chain.json round-trip)', async () => {
      const first = h.build();
      await first.orch.configure(h.config());
      await first.orch.setPersonaPaused('pia', true);
      await first.orch.setPersonaPaused('ben', true);
      await first.orch.setPersonaPaused('ben', false);

      const second = h.build();
      await second.orch.load();
      expect(second.orch.status().pausedPersonas).toEqual(['pia']);
    });
  });
});
