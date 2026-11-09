import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeFleetPools, type RunRequest } from '../protocol';
import { ChainHarness, failedRecord, fakePort, ONE, pipelineWithPlan, type FakeFleet } from './chain-harness.fake';

/**
 * Which provider pool a card's run counts against without the capacity
 * pool (req-63, E3): the shared provider pools and a persona's harness —
 * through the real composition over a fake dricket store. With the pool
 * wired, `class-dispatch.spec.ts` covers the class request (req-170).
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
