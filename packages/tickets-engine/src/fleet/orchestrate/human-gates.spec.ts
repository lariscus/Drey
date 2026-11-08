import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChainHarness, ONE, pipelineWithPlan } from './chain-harness.fake';

/**
 * Manual steps (E10-6, req-176): a gate the human persona works runs no
 * agent — the ticket parks where it sits with `awaiting:` (one `put`
 * through the store door, `x-awaiting` in the document) and a `paused:`
 * comment; a manual step after a gate rides the run request as `parkFor`.
 */

let h: ChainHarness;

describe('HumanGates (E10-6)', () => {
  beforeEach(async () => {
    h = new ChainHarness();
    await h.setUp();
  });

  afterEach(async () => {
    await h.tearDown();
  });

  it('a gate the human persona works parks the ticket: no run, no worktree, awaiting set', async () => {
    await h.writeHuman();
    h.io.seed('T-0200', 'plan', { chain: ['assign plan you'] });
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');

    expect(fleet.start).not.toHaveBeenCalled();
    expect(h.io.stageOf('T-0200')).toBe('plan');
    const text = h.io.textOf('T-0200');
    expect(text).toMatch(/^x-awaiting: you$/m);
    expect(text).toContain('parked for You');
    expect(h.io.commentsOn('T-0200').map((c) => c.text)).toEqual([expect.stringMatching(/^paused: parked for You/)]);
    // a second pass does not park again (the Log line is written once)
    await orch.setMaster('run');
    expect(h.io.writesTo('T-0200')).toHaveLength(1);
    expect(h.io.textOf('T-0200').match(/parked for You/g)).toHaveLength(1);
    expect(h.io.commentsOn('T-0200')).toHaveLength(1);
  });

  it('the phase persona being human parks every ticket of the column', async () => {
    await h.writeHuman();
    await h.write('tickets/_meta/pipeline.md', pipelineWithPlan('persona: you'));
    h.io.seed('T-0201', 'plan');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');

    expect(fleet.start).not.toHaveBeenCalled();
    expect(h.io.textOf('T-0201')).toMatch(/^x-awaiting: you$/m);
  });

  it('an awaiting ticket is never dispatched, and the human never takes a pool slot', async () => {
    await h.writeHuman();
    h.io.seed('T-0202', 'plan', { chain: ['assign plan you'] });
    h.io.seed('T-0203', 'plan');
    const { orch, fleet } = h.build();
    await orch.configure(h.config({ pools: ONE }));
    await orch.setMaster('run');

    // the only slot went to the agent ticket although the parked one ranks first
    expect(fleet.records.map((r) => r.request.ticketId)).toEqual(['T-0203']);
  });

  it('a manual step after the gate rides the run request: it parks, it does not move on', async () => {
    h.io.seed('T-0204', 'plan', { chain: ['insert manual(you, notify) after plan'] });
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');

    const request = fleet.records[0]!.request;
    expect(request.parkFor).toBe('you');
    expect(request.nextPhase).toBeNull();
    expect(request.nextPhaseDir).toBeNull();
  });

  it('a manual step names an agent persona: ignored, the chain goes on', async () => {
    await h.writeHuman('ben', 'agent');
    h.io.seed('T-0205', 'plan', { chain: ['insert manual(ben) after plan'] });
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');

    const request = fleet.records[0]!.request;
    expect(request.parkFor).toBeUndefined();
    expect(request.nextPhase).toBe('plan-review');
  });

  it('a ticket without a manual step keeps its normal move', async () => {
    h.io.seed('T-0206', 'plan');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records[0]!.request.parkFor).toBeUndefined();
    expect(fleet.records[0]!.request.nextPhase).toBe('plan-review');
  });
});
