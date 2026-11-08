import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StartOutcome } from '../run/run-record';
import { ChainHarness, fakePort, ONE } from './chain-harness.fake';
import type { SupervisorPort } from './supervisor-directory';

/**
 * One dispatch round (M85): which columns feed a pool, capacity and busy
 * tickets, and the chain log's "why nothing moves" — said once per ticket
 * and reason, never on every pass. The board comes from a fake dricket
 * store; the composition is the real one.
 */

let h: ChainHarness;

describe('Dispatcher', () => {
  beforeEach(async () => {
    h = new ChainHarness();
    await h.setUp();
  });

  afterEach(async () => {
    await h.tearDown();
  });

  it('dispatches the plan pool from its own queue — never from prioritized', async () => {
    h.io.seed('T-0001', 'prioritized');
    h.io.seed('T-0002', 'prioritized');
    h.io.seed('T-0003', 'plan');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');

    // The owner's queue (prioritized) is never touched: only the ticket
    // the owner moved into the worker column runs.
    const started = fleet.records.filter((r) => r.info.state === 'running');
    expect(started.map((r) => r.request.ticketId)).toEqual(['T-0003']);
    expect(started[0]!.request.phase).toBe('plan');
    expect(started[0]!.request.column).toBe('plan');
    expect(started[0]!.request.nextPhase).toBe('plan-review');
    expect(started[0]!.request.model).toBe('zai/glm-5.3');
    expect(started[0]!.request.instruction).toContain('Work the plan step.');
  });

  it('never pulls from a manual column: neither prioritized nor the checkpoint feeds a pool', async () => {
    h.io.seed('T-0004', 'plan-review');
    h.io.seed('T-0005', 'commit');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records).toEqual([]);
  });

  it('the chain log says why nothing moves — once, not on every pass', async () => {
    // T-0001 names a repo that is not in repos.md: the dispatch note.
    h.io.seed('T-0001', 'plan', { repos: ['nowhere'] });
    // T-0002 is dispatchable, but its column is held: the held note.
    h.io.seed('T-0002', 'plan-review');
    const { orch, fleet, logs } = h.build();
    await orch.configure(h.config());
    await orch.setColumn('plan-review', 'held');
    await orch.setMaster('run');
    await orch.setMaster('halted');
    await orch.setMaster('run'); // second pass — the notes must stay silent

    const skips = logs.filter((line) => line.includes('T-0001'));
    expect(skips).toHaveLength(1);
    expect(skips[0]).toContain('repo "nowhere" is not in repos.md');
    const held = logs.filter((line) => line.includes('held column'));
    expect(held).toHaveLength(1);
    expect(held[0]).toContain('T-0002');
    expect(fleet.records).toEqual([]);
  });

  it('a refused start parks the column queue behind it — the chain log says so', async () => {
    // One OpenCode slot — the column takes one ticket, and its refused
    // start must not leave the queued one silently waiting (the outage
    // shape: one poisoned worktree parked a whole column).
    h.io.seed('T-0001', 'build');
    h.io.seed('T-0002', 'build');
    const fleet = fakePort();
    const refusing: SupervisorPort = {
      ...fleet.port,
      start: vi.fn(async (): Promise<StartOutcome> => ({ ok: false, error: 'worktree failed: worktree W:/wt is on main, expected t/T-0001' })),
    };
    const { orch, logs } = h.build({ fleet: { ...fleet, port: refusing } });
    await orch.configure(h.config({ pools: ONE }));
    await orch.setMaster('run');
    await orch.setMaster('halted');
    await orch.setMaster('run'); // second pass — the notes must stay silent

    expect(fleet.records).toEqual([]);
    const refusal = logs.filter((line) => line.startsWith('dispatch refused'));
    expect(refusal).toHaveLength(1);
    expect(refusal[0]).toContain('is on main, expected');
    const waits = logs.filter((line) => line.startsWith('dispatch waits'));
    expect(waits).toHaveLength(1);
    expect(waits[0]).toContain("build's dispatch of");
    expect(waits[0]).toContain('was refused — the queue cannot advance');
  });

  it('a queued candidate behind a live run says why it waits (no free slot)', async () => {
    h.io.seed('T-0001', 'build');
    h.io.seed('T-0002', 'build');
    const { orch, fleet, logs } = h.build();
    await orch.configure(h.config({ pools: ONE }));
    await orch.setMaster('run');

    expect(fleet.records).toHaveLength(1); // one OpenCode slot — one runs, one queues
    const waits = logs.filter((line) => line.startsWith('dispatch waits'));
    expect(waits).toHaveLength(1);
    expect(waits[0]).toContain('no free opencode pool slot yet');
  });

  it('respects capacity, held columns and busy tickets', async () => {
    h.io.seed('T-0001', 'plan');
    h.io.seed('T-0002', 'plan');
    h.io.seed('T-0003', 'plan');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    // two OpenCode slots — exactly two runs, no pull happened (none available).
    expect(fleet.records).toHaveLength(2);

    // A settled run frees the slot; the moved ticket leaves the plan
    // column (the success move), and the third ticket goes on the next pass.
    fleet.end(fleet.records[0]!, { state: 'done' });
    h.io.move('T-0001', 'plan-review');
    await orch.setMaster('halted');
    await orch.setMaster('run');
    expect(fleet.records.filter((r) => r.info.state === 'running')).toHaveLength(2);
    expect(fleet.records.map((r) => r.request.ticketId)).toContain('T-0003');
  });

  it('a worker waiting on the owner frees its pool slot but keeps its ticket', async () => {
    h.io.seed('T-0001', 'plan');
    h.io.seed('T-0002', 'plan');
    const { orch, fleet } = h.build();
    await orch.configure(h.config({ pools: ONE }));
    await orch.setMaster('run');
    expect(fleet.records).toHaveLength(1); // one slot, one worker

    fleet.end(fleet.records[0]!, { turn: 'idle', waiting: { kind: 'question', text: 'Which one?', since: '2026-10-18T12:01:00Z' } });
    await orch.setMaster('halted');
    await orch.setMaster('run');
    const tickets = fleet.records.map((r) => r.info.ticketId);
    expect(tickets).toHaveLength(2);
    expect(new Set(tickets).size).toBe(2); // the other ticket got the slot, the waiting one is not run twice
  });
});
