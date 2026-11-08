import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeFleetPools, type RunRequest } from '../protocol';
import { ChainHarness, failedRecord, fakePort, ONE, pipelineWithPlan, type FakeFleet } from './chain-harness.fake';

/**
 * Which provider pool a card's run takes (req-63, E3, D-62): the shared
 * provider pools, a persona's own pool, its pool entries and its router —
 * through the real composition over a fake dricket store.
 */

let h: ChainHarness;

/** A fleet whose one claude-code slot is already taken by another ticket's run. */
function busyClaudeFleet(): FakeFleet {
  const fleet = fakePort();
  fleet.records.push({
    info: { ...failedRecord('T-0098', '').info, id: 'R-seed', state: 'running', provider: 'claude-code' },
    request: { ticketId: 'T-0098', column: 'plan' } as RunRequest,
  });
  return fleet;
}

describe('PassPools', () => {
  beforeEach(async () => {
    h = new ChainHarness();
    await h.setUp();
  });

  afterEach(async () => {
    await h.tearDown();
  });

  it('the provider pool is shared: an idle slot serves the rightmost column first (req-63)', async () => {
    h.io.seed('T-0001', 'plan');
    h.io.seed('T-0002', 'build');
    const { orch, fleet } = h.build();
    await orch.configure(h.config({ pools: ONE }));
    await orch.setMaster('run');
    expect(fleet.records.map((r) => r.info.ticketId)).toEqual(['T-0002']);
  });

  it("the persona's pool acts at dispatch: the second entry runs when the first entry's pool is full (D-62)", async () => {
    await h.write('tickets/_meta/pipeline.md', pipelineWithPlan('persona: pia'));
    await h.writePersona('pia', { worker: 'claude-code', model: 'sonnet', pool: ['sonnet', 'kimi/k2'] });
    h.io.seed('T-0120', 'plan');
    // The one claude-code slot is taken: the pool's second entry names kimi, which is free.
    const { orch, fleet, logs } = h.build({ fleet: busyClaudeFleet() });
    await orch.configure(h.config({ pools: normalizeFleetPools({ opencode: { size: 1 }, 'claude-code': { size: 1 }, kimi: { size: 1 } }) }));
    await orch.setMaster('run');

    const started = fleet.records.find((r) => r.info.id !== 'R-seed');
    expect(started).toBeDefined();
    expect(started!.request.provider).toBe('kimi');
    expect(started!.request.model).toBe('k2');
    expect(fleet.start.mock.calls[0]![1]).toEqual({ persona: 'pia' });
    // runner.log names the chosen model and why
    const line = logs.find((l) => l.startsWith('dispatched T-0120'));
    expect(line).toContain('kimi/k2');
    expect(line).toContain('claude-code pool is full');
  });

  it("the persona's router is honoured: escalate-on-fail climbs the pool after a failed run (D-62)", async () => {
    await h.write('tickets/_meta/pipeline.md', pipelineWithPlan('persona: pia'));
    await h.writePersona('pia', { worker: 'claude-code', model: 'sonnet', pool: ['sonnet', 'opus'], router: 'escalate-on-fail' });
    h.io.seed('T-0121', 'plan');
    const fleet = fakePort();
    const failed = failedRecord('T-0121', 'gate red');
    fleet.records.push({ ...failed, info: { ...failed.info, provider: 'claude-code' } });
    const { orch, logs } = h.build({ fleet });
    await orch.configure(h.config({ pools: normalizeFleetPools({ 'claude-code': { size: 2 } }) }));
    await orch.setMaster('run');

    const started = fleet.records.find((r) => r.info.state === 'running');
    expect(started!.request.provider).toBe('claude-code');
    expect(started!.request.model).toBe('opus');
    expect(logs.find((l) => l.startsWith('dispatched T-0121'))).toContain('escalate-on-fail');
  });

  it('the persona takes its own provider pool slot', async () => {
    await h.write('tickets/_meta/pipeline.md', pipelineWithPlan('persona: pia'));
    await h.writePersona('pia', { worker: 'claude-code', model: 'sonnet' });
    h.io.seed('T-0105', 'plan'); // persona → the claude-code pool
    h.io.seed('T-0106', 'build'); // the ring → the opencode pool
    // One claude-code slot, already taken: the persona ticket waits while
    // the ring ticket dispatches on the free opencode slot.
    const { orch, fleet, logs } = h.build({ fleet: busyClaudeFleet() });
    await orch.configure(h.config({ pools: normalizeFleetPools({ opencode: { size: 1 }, 'claude-code': { size: 1 } }) }));
    await orch.setMaster('run');

    expect(fleet.records.filter((r) => r.info.state === 'running' && r.info.id !== 'R-seed')).toHaveLength(1);
    expect(fleet.records.find((r) => r.info.id !== 'R-seed')!.request.ticketId).toBe('T-0106');
    const waits = logs.filter((line) => line.startsWith('dispatch waits'));
    expect(waits).toHaveLength(1);
    expect(waits[0]).toContain('T-0105');
    expect(waits[0]).toContain('no free claude-code pool slot yet');
  });
});
