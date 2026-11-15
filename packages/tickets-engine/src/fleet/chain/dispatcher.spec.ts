import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StartOutcome } from '../runner/run-record';
import { ChainHarness, fakePort, ONE } from './chain-harness.fake';
import type { SupervisorPort } from '../runner/supervisor-directory';

/**
 * One dispatch round (M85, req-257): which tickets feed a pool (the holders),
 * capacity and busy tickets, and the chain log's "why nothing moves" — said
 * once per ticket and reason, never on every pass. The board comes from a
 * fake dricket store; the composition is the real one.
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

  it("dispatches the holder's run only — never from the owner's queue (inbox, prioritized)", async () => {
    h.io.seed('T-0001', 'prioritized');
    h.io.seed('T-0002', 'prioritized');
    h.seedRun('T-0003');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');

    // The owner's queue (prioritized) is never touched: only the ticket
    // whose chain entry at the cursor is an agent persona runs.
    const started = fleet.records.filter((r) => r.info.state === 'running');
    expect(started.map((r) => r.request.ticketId)).toEqual(['T-0003']);
    expect(started[0]!.request.phase).toBe('active');
    expect(started[0]!.request.column).toBe('active');
    expect(started[0]!.request.model).toBe('opus');
    expect(started[0]!.request.instruction).toContain('Build it.');
  });

  it('never pulls what is not an agent holder: the owner columns and a You entry feed no pool', async () => {
    h.io.seed('T-0004', 'inbox');
    h.io.seed('T-0005', 'prioritized');
    h.io.seed('T-0006', 'done');
    h.seedRun('T-0007', { at: 2 }); // the cursor stands at You
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records).toEqual([]);
  });

  it('the chain log says why nothing moves — once, not on every pass', async () => {
    await h.writePersona('ann');
    // T-0001 names a repo that is not in repos.md: the dispatch note.
    h.seedRun('T-0001', { repos: ['nowhere'] });
    // T-0002 is dispatchable, but its persona is paused: the paused note.
    h.seedRun('T-0002', { persona: 'ann' });
    const { orch, fleet, logs } = h.build();
    await orch.configure(h.config());
    await orch.setPersonaPaused('ann', true);
    await orch.setMaster('run');
    await orch.setMaster('halted');
    await orch.setMaster('run'); // second pass — the notes must stay silent

    const skips = logs.filter((line) => line.includes('T-0001'));
    expect(skips).toHaveLength(1);
    expect(skips[0]).toContain('repo "nowhere" is not in repos.md');
    const paused = logs.filter((line) => line.includes('is paused'));
    expect(paused).toHaveLength(1);
    expect(paused[0]).toContain('T-0002');
    expect(fleet.records).toEqual([]);
  });

  it('a refused start says so once — the chain log names the reason, not every pass', async () => {
    // One OpenCode slot — the start is refused (the outage shape: one
    // poisoned worktree), and the log must not repeat it on every pass.
    h.seedRun('T-0001');
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
  });

  it('a queued candidate behind a live run says why it waits (no free slot)', async () => {
    h.seedRun('T-0001');
    h.seedRun('T-0002');
    const { orch, fleet, logs } = h.build();
    await orch.configure(h.config({ pools: ONE }));
    await orch.setMaster('run');

    expect(fleet.records).toHaveLength(1); // one OpenCode slot — one runs, one queues
    const waits = logs.filter((line) => line.startsWith('dispatch waits'));
    expect(waits).toHaveLength(1);
    expect(waits[0]).toContain('no free');
  });

  it('respects capacity and busy tickets', async () => {
    h.seedRun('T-0001');
    h.seedRun('T-0002');
    h.seedRun('T-0003');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    // two OpenCode slots — exactly two runs, no pull happened (none available).
    expect(fleet.records).toHaveLength(2);

    // A settled run frees the slot; the ticket's cursor moved on to You (the
    // success hand-on), and the third ticket goes on the next pass.
    fleet.end(fleet.records[0]!, { state: 'done' });
    h.io.seed(fleet.records[0]!.request.ticketId, 'active', { chain: ['ben', 'you'], extensions: { at: '2' } });
    await orch.setMaster('halted');
    await orch.setMaster('run');
    expect(fleet.records.filter((r) => r.info.state === 'running')).toHaveLength(2);
    expect(fleet.records.map((r) => r.request.ticketId)).toContain('T-0003');
  });

  it('a worker waiting on the owner frees its pool slot but keeps its ticket', async () => {
    h.seedRun('T-0001');
    h.seedRun('T-0002');
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
