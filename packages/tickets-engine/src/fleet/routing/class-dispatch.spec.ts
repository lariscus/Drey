import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunInfo } from '../protocol';
import { slot } from './routing.fake';
import { ChainHarness, fakePort } from '../chain/chain-harness.fake';
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
/** req-287: at most one heavy session at once; the rows carry no sessions of their own. */
const TABLE = {
  classes: ['super heavy', { name: 'heavy', sessions: 1 }, 'standard', 'light'],
  models: [
    { model: 'opus', slot: 'claude-a', category: 'frontier', class: 'heavy', cost: 5 },
    { model: 'sonnet', slot: 'claude-a', category: 'everyday', class: 'standard', cost: 1 },
  ],
};

let h: ChainHarness;

async function setUp(config: Record<string, unknown> = TABLE, cls?: string): Promise<{ rig: PoolRig; built: ReturnType<ChainHarness['build']> }> {
  // A v2 record (its old default opus: heavy, by the migration's rule) unless a v3 class is named (req-288).
  await h.writePersona('ben', cls !== undefined ? { class: cls } : { worker: 'claude-code', model: 'opus', pool: ['opus', 'sonnet'] });
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

  it('waits, never downgrades: the second heavy ticket queues while the standard model is free', async () => {
    h.seedRun('T-0001', { rank: 1000 });
    h.seedRun('T-0002', { rank: 2000 });
    const { built } = await setUp();
    await built.orch.configure(h.config());
    await built.orch.setMaster('run');

    expect(built.fleet.records.map((r) => [r.request.ticketId, r.request.model, r.request.poolClass])).toEqual([['T-0001', 'opus', 'heavy']]);
    expect(built.fleet.records[0]!.info.grant).toMatchObject({ requested: 'heavy', class: 'heavy', model: 'opus', cost: 5 });
    expect(built.orch.status().queue).toMatchObject([{ ticket: 'T-0002', persona: 'ben', class: 'heavy', reason: 'capacity', line: 'waits for a heavy slot', position: 1 }]);
    expect(built.orch.status().pool).toMatchObject({
      used: 5,
      slots: [{ id: 'claude-a', used: 5, cap: null }],
      classes: [
        { name: 'super heavy', busy: 0, cap: null },
        { name: 'heavy', busy: 1, cap: 1 },
        { name: 'standard', busy: 0, cap: null },
        { name: 'light', busy: 0, cap: null },
      ],
    });
    expect(built.logs.some((line) => line.startsWith('dispatch waits T-0002: queued · waits for a heavy slot'))).toBe(true);
  });

  it('serves the queue front to back when capacity frees', async () => {
    h.seedRun('T-0001', { rank: 1000 });
    h.seedRun('T-0002', { rank: 2000 });
    h.seedRun('T-0003', { rank: 3000 });
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

  it("req-288: the persona's class asks; the part's size raises it, the reason rides the request", async () => {
    h.seedRun('T-0004', { extensions: { size: 'L' } });
    const { built } = await setUp(TABLE, 'standard');
    await built.orch.configure(h.config());
    await built.orch.setMaster('run');
    expect(built.fleet.records.map((r) => [r.request.model, r.request.poolClass, r.request.poolWhy])).toEqual([['opus', 'heavy', "ben's class standard, raised to heavy (size L → heavy)"]]);
    expect(built.logs.find((line) => line.startsWith('dispatched T-0004'))).toContain('opus, class heavy, cost 5 on Claude A');
  });

  it('req-288: a size never lowers the class', async () => {
    h.seedRun('T-0004', { extensions: { size: 'S' } });
    const { built } = await setUp(TABLE, 'standard');
    await built.orch.configure(h.config());
    await built.orch.setMaster('run');
    expect(built.fleet.records.map((r) => [r.request.model, r.request.poolClass])).toEqual([['sonnet', 'standard']]);
  });

  it('req-288: a pinned model runs alone — the router grants no other model of the class', async () => {
    h.seedRun('T-0004');
    const rig = new PoolRig([CLAUDE_A], NOW);
    await rig.load(TABLE);
    await h.writePersona('ben', { class: 'standard', pin: 'claude-code/sonnet' });
    const built = h.build({ fleet: rig.binding(fakePort()), pool: rig.dispatchPool(), now: () => NOW });
    await built.orch.configure(h.config());
    await built.orch.setMaster('run');
    expect(built.fleet.records.map((r) => [r.request.provider, r.request.model, r.request.poolWhy])).toEqual([['claude-code', 'sonnet', 'ben pins model claude-code/sonnet']]);
  });

  it("req-178: the ticket's needs ride the start with the dispatch's route; a model without the capability is never taken", async () => {
    h.seedRun('T-0004', { extensions: { needs: 'image' } });
    const vision = { ...TABLE, models: [TABLE.models[0], { ...TABLE.models[1], input: ['text', 'image'] }] };
    const { built } = await setUp(vision, 'standard');
    await built.orch.configure(h.config());
    await built.orch.setMaster('run');
    const started = built.fleet.records[0]?.request;
    expect(started).toMatchObject({ model: 'sonnet', poolNeeds: { image: true }, poolRoute: { slot: 'claude-a', model: 'sonnet', class: 'standard', requested: 'standard' } });
    expect(built.fleet.records[0]?.info.grant?.route?.line).toBe('route T-0004 → claude-a/sonnet: class standard, q ?, est ?');
  });

  it('req-178: no model of the class reads images — the ticket waits on the configuration, named', async () => {
    h.seedRun('T-0004', { extensions: { needs: 'image' } });
    const { built } = await setUp(TABLE, 'standard');
    await built.orch.configure(h.config());
    await built.orch.setMaster('run');
    expect(built.fleet.records).toEqual([]);
    expect(built.logs.find((line) => line.startsWith('dispatch waits T-0004'))).toContain('sonnet on Claude A: image input not declared');
  });

  it('a full ledger grants nothing and raises one Needs-you card; the grant resolves it', async () => {
    h.seedRun('T-0005', { extensions: { allowance: '2' } });
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

    h.seedRun('T-0005', { extensions: { allowance: '5' } });
    await built.orch.setMaster('run');
    expect(built.fleet.records.map((r) => r.request.ticketId)).toEqual(['T-0005']);
    expect(built.fleet.records[0]!.request.ledger).toEqual({ allowance: 5, personaBudget: null, spendAboveAllowance: false });
    expect(h.io.commentsOn('T-0005').map((c) => c.text)).toContain('resolved: ledger-ticket');
  });
});
