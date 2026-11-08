import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChainHarness, PIPELINE, pipelineWithPlan } from './orchestrate/chain-harness.fake';
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
    h.io.seed('T-0001', 'plan');
    h.io.seed('T-0002', 'plan');
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

  it('stopping one column holds only that column and aborts only its runs', async () => {
    h.io.seed('T-0001', 'plan');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records).toHaveLength(1);
    const runId = fleet.records[0]!.info.id;

    await orch.stopColumn('plan');
    expect(fleet.stop).toHaveBeenCalledWith(runId, 'column plan stopped');
    expect(orch.status().columns['plan']).toBe('held');

    // Another configure pass dispatches nothing while the column holds.
    await orch.configure(h.config());
    expect(fleet.start).toHaveBeenCalledTimes(1);

    await orch.setColumn('plan', 'playing');
    expect(fleet.start).toHaveBeenCalledTimes(2);
  });

  it('persists column state in chain.json, but the master always boots halted', async () => {
    h.io.seed('T-0001', 'plan');
    const first = h.build();
    await first.orch.configure(h.config());
    await first.orch.setMaster('run');
    await first.orch.setColumn('plan', 'held');
    first.orch.dispose();

    const second = h.build();
    await second.orch.load();
    const status = second.orch.status();
    expect(status.configured).toBe(true);
    // "An" is a per-session decision: the persisted master never resumes.
    expect(status.master).toBe('halted');
    expect(status.columns['plan']).toBe('held');
    // Halted means: no dispatch on boot either.
    expect(second.fleet.records).toEqual([]);
    // The owner's session: An, then the column's state applies again.
    await second.orch.setMaster('run');
    await second.orch.setColumn('plan', 'playing');
    expect(second.fleet.records).toHaveLength(1);
  });

  it('drops the control state of phases the pipeline no longer has', async () => {
    h.io.seed('T-0001', 'build');
    const first = h.build();
    await first.orch.configure(h.config());
    await first.orch.setMaster('run');
    await first.orch.setColumn('plan-review', 'held');
    await first.orch.setColumn('build', 'held');
    first.orch.dispose();

    // The owner removes the plan-review column from the pipeline.
    await h.write('tickets/_meta/pipeline.md', PIPELINE.split('\n').filter((line) => !line.includes('id: plan-review')).join('\n'));

    const second = h.build();
    await second.orch.load();
    // Loaded — the stale key survives until a pass has read the pipeline.
    expect(second.orch.status().columns['plan-review']).toBe('held');
    await second.orch.configure(h.config());
    const status = second.orch.status();
    expect(status.columns['plan-review']).toBeUndefined();
    const chain = (await h.chainFile()) as { columns: Record<string, string> };
    expect(chain.columns['plan-review']).toBeUndefined();
    // A phase the pipeline still has keeps its state.
    expect(status.columns['build']).toBe('held');
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
    h.io.seed('T-0001', 'plan');
    h.io.seed('T-0002', 'plan');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records).toHaveLength(2);
    await orch.setMaster('halted');

    // T-0003 arrives externally; a settle (its ticket moved on) fires the pass that takes it.
    h.io.seed('T-0003', 'plan');
    await orch.setMaster('run');
    h.io.move('T-0001', 'plan-review');
    await orch.onRunSettled(fleet.end(fleet.records[0]!, { state: 'done' }));
    expect(fleet.records.map((r) => r.request.ticketId)).toEqual(['T-0001', 'T-0002', 'T-0003']);
  });

  it('the lease reaper is reachable through the ports', async () => {
    const { orch, fleet } = h.build();
    await orch.reapAll();
    expect(fleet.port.reap).toHaveBeenCalled();
  });

  it('a chain config without a store dispatches nothing and says so once (req-176)', async () => {
    h.io.seed('T-0001', 'plan');
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
      await h.write('tickets/_meta/pipeline.md', pipelineWithPlan('persona: pia'));
      await h.writePersona('pia', { worker: 'claude-code', model: 'sonnet' });
      h.io.seed('T-0110', 'plan'); // the persona column
      h.io.seed('T-0111', 'build'); // the ring — not the persona's business
      const { orch, fleet, logs } = h.build();
      await orch.configure(h.config());
      await orch.setPersonaPaused('pia', true);
      await orch.setMaster('run');

      expect(fleet.records.some((r) => r.info.ticketId === 'T-0110')).toBe(false);
      expect(logs.some((line) => line.includes('dispatch holds T-0110: persona "pia" is paused'))).toBe(true);
      expect(orch.status().pausedPersonas).toEqual(['pia']);
      // persisted in chain.json like every control state
      expect((await h.chainFile())['pausedPersonas']).toEqual(['pia']);
      // the ring's ticket dispatches normally while pia is paused
      await orch.setColumn('build', 'playing'); // triggers a pass
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
