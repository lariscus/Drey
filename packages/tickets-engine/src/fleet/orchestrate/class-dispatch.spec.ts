import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunInfo } from '../protocol';
import { slot } from '../routing/routing.fake';
import { ChainHarness, fakePort, pipelineWithPlan } from './chain-harness.fake';
import { PoolRig } from './pool.fake';

/**
 * The class request at dispatch (req-170, R10) through the real composition
 * and the real pool of `fleet/routing`: a persona's ticket gets a model of
 * exactly its class or waits — no process, a queue entry, the log line —
 * the queue is served front to back when capacity frees, and a full ledger
 * raises one Needs-you card and resolves it once the pool grants again.
 */

const NOW = new Date('2026-10-18T12:00:00Z');
const CLAUDE_A = slot({ id: 'claude-a', label: 'Claude A', sessions: 4 });
const TABLE = {
  models: [
    { model: 'opus', slot: 'claude-a', category: 'frontier', class: 'A', cost: 5, sessions: 1 },
    { model: 'sonnet', slot: 'claude-a', category: 'everyday', class: 'B', cost: 1, sessions: 2 },
  ],
};

let h: ChainHarness;

async function setUp(config: Record<string, unknown> = TABLE): Promise<{ rig: PoolRig; built: ReturnType<ChainHarness['build']> }> {
  await h.write('tickets/_meta/pipeline.md', pipelineWithPlan('persona: ben'));
  await h.writePersona('ben', { worker: 'claude-code', model: 'opus', pool: ['opus', 'sonnet'] });
  const rig = new PoolRig([CLAUDE_A], NOW);
  await rig.load(config);
  const built = h.build({ fleet: rig.binding(fakePort()), pool: rig.dispatchPool(), now: () => NOW });
  return { rig, built };
}

describe('the class request at dispatch (req-170)', () => {
  beforeEach(async () => {
    h = new ChainHarness();
    await h.setUp();
  });

  afterEach(async () => {
    await h.tearDown();
  });

  it('waits, never downgrades: the second class-A ticket queues while the B model is free', async () => {
    h.io.seed('T-0001', 'plan', { rank: 1000 });
    h.io.seed('T-0002', 'plan', { rank: 2000 });
    const { built } = await setUp();
    await built.orch.configure(h.config());
    await built.orch.setMaster('run');

    expect(built.fleet.records.map((r) => [r.request.ticketId, r.request.model, r.request.poolClass])).toEqual([['T-0001', 'opus', 'A']]);
    expect(built.fleet.records[0]!.info.grant).toMatchObject({ requested: 'A', class: 'A', model: 'opus', cost: 5 });
    expect(built.orch.status().queue).toMatchObject([{ ticket: 'T-0002', persona: 'ben', class: 'A', reason: 'capacity', line: 'waits for a A slot', position: 1 }]);
    expect(built.orch.status().pool).toMatchObject({ used: 5, slots: [{ id: 'claude-a', used: 5, cap: 5 }] });
    expect(built.logs.some((line) => line.startsWith('dispatch waits T-0002: queued · waits for a A slot'))).toBe(true);
  });

  it('serves the queue front to back when capacity frees', async () => {
    h.io.seed('T-0001', 'plan', { rank: 1000 });
    h.io.seed('T-0002', 'plan', { rank: 2000 });
    h.io.seed('T-0003', 'plan', { rank: 3000 });
    const { rig, built } = await setUp();
    await built.orch.configure(h.config());
    await built.orch.setMaster('run');
    expect(built.orch.status().queue?.map((e) => [e.ticket, e.position])).toEqual([['T-0002', 1], ['T-0003', 2]]);

    h.io.move('T-0001', 'done');
    const ended: RunInfo = built.fleet.end(built.fleet.records[0]!, { state: 'done', endedAt: NOW.toISOString() });
    rig.settle(ended);
    await built.orch.onRunSettled(ended);

    expect(built.fleet.records.map((r) => r.request.ticketId)).toEqual(['T-0001', 'T-0002']);
    expect(built.orch.status().queue?.map((e) => [e.ticket, e.position])).toEqual([['T-0003', 1]]);
  });

  it("asks for the part's size: M → class B, the reason rides the request", async () => {
    h.io.seed('T-0004', 'plan', { extensions: { size: 'M' } });
    const { built } = await setUp();
    await built.orch.configure(h.config());
    await built.orch.setMaster('run');
    expect(built.fleet.records.map((r) => [r.request.model, r.request.poolClass, r.request.poolWhy])).toEqual([['sonnet', 'B', 'size M → B']]);
    expect(built.logs.find((line) => line.startsWith('dispatched T-0004'))).toContain('sonnet, class B, cost 1 on Claude A — size M → B');
  });

  it('a full ledger grants nothing and raises one Needs-you card; the grant resolves it', async () => {
    h.io.seed('T-0005', 'plan', { extensions: { allowance: '2' } });
    const { rig, built } = await setUp();
    rig.book.seed([{ id: 'R-old', ticketId: 'T-0005', persona: 'ben', costUsd: 3, startedAt: NOW.toISOString() } as RunInfo]);
    await built.orch.configure(h.config());
    await built.orch.setMaster('run');
    await built.orch.setMaster('run');

    expect(built.fleet.records).toHaveLength(0);
    expect(built.orch.status().queue).toMatchObject([{ ticket: 'T-0005', reason: 'ledger', line: 'waits: T-0005 has spent $3.00 of its $2.00 allowance' }]);
    expect(h.io.commentsOn('T-0005').map((c) => c.text.split('\n')[0])).toEqual([
      "blocked: [ledger-ticket] T-0005 has spent $3.00 of its $2.00 allowance — raise the ticket's allowance: or let the persona spend above it (allowed: spend-above-allowance)",
    ]);

    h.io.seed('T-0005', 'plan', { extensions: { allowance: '5' } });
    await built.orch.setMaster('run');
    expect(built.fleet.records.map((r) => r.request.ticketId)).toEqual(['T-0005']);
    expect(built.fleet.records[0]!.request.ledger).toEqual({ allowance: 5, personaBudget: null, spendAboveAllowance: false });
    expect(h.io.commentsOn('T-0005').map((c) => c.text)).toContain('resolved: ledger-ticket');
  });
});
