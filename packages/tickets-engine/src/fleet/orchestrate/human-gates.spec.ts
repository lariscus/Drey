import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChainHarness, ONE, pipelineWithPlan } from './chain-harness.fake';

/**
 * Manual steps (E10-6, req-176): a gate the human persona works runs no
 * agent — the ticket parks where it sits with `awaiting:` (one `put`
 * through the store door, `x-awaiting` in the document) and a `paused:`
 * comment. req-266: the chain is a persona list now and inserts no manual
 * step until req-257 parks at a You entry.
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
    h.io.seed('T-0200', 'plan', { persona: 'you' });
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
    h.io.seed('T-0202', 'plan', { persona: 'you' });
    h.io.seed('T-0203', 'plan');
    const { orch, fleet } = h.build();
    await orch.configure(h.config({ pools: ONE }));
    await orch.setMaster('run');

    // the only slot went to the agent ticket although the parked one ranks first
    expect(fleet.records.map((r) => r.request.ticketId)).toEqual(['T-0203']);
  });

  it('a persona-list chain pins nothing and inserts no manual step until req-257 walks it: the chain goes on', async () => {
    await h.writeHuman();
    h.io.seed('T-0204', 'plan', { chain: ['ben', 'you(notify)'] });
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
