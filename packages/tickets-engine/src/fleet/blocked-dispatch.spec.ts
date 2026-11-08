import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChainHarness } from './orchestrate/chain-harness.fake';

/**
 * The fleet respects blocked-by (T-0050): the real orchestrator over a fake
 * dricket store (a blocker is a `depends:` entry) and a fake supervisor
 * port — a blocked ticket is never picked by a worker column; the chain log
 * says why.
 */

const PIPELINE = [
  '---',
  'phases:',
  '  - { id: inbox, title: Inbox, handover: manual }',
  '  - { id: prioritized, title: Prioritized, handover: manual }',
  '  - { id: plan, title: Plan, handover: agent plan-default, worker: opencode, workers: 2 }',
  '  - { id: plan-review, title: Plan review, handover: manual }',
  '  - { id: build, title: Build, handover: agent build-default, workers: 1, claim: true }',
  '  - { id: done, title: Done, handover: none }',
  '---',
  'Prose.',
  '',
].join('\n');

let h: ChainHarness;

describe('the fleet respects blocked-by (T-0050)', () => {
  beforeEach(async () => {
    h = new ChainHarness();
    await h.setUp(PIPELINE);
  });

  afterEach(async () => {
    await h.tearDown();
  });

  it('a pass starts only the free ticket and logs the blocked id with its blockers', async () => {
    h.io.seed('T-0002', 'build'); // the blocker — nowhere near done
    // The blocked ticket sorts ABOVE the free one (the id tiebreak).
    h.io.seed('T-0001', 'plan', { depends: ['T-0002'] });
    h.io.seed('T-0003', 'plan');
    const { orch, fleet, logs } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');

    const started = fleet.records.filter((r) => r.info.state === 'running');
    // The plan pool takes only the free ticket; the blocker itself may
    // run in its own build pool — it is not the blocked one.
    expect(started.filter((r) => r.request.column === 'plan').map((r) => r.request.ticketId)).toEqual(['T-0003']);
    expect(started.map((r) => r.request.ticketId)).toContain('T-0002');
    const holds = logs.filter((line) => line.includes('T-0001'));
    expect(holds).toHaveLength(1);
    expect(holds[0]).toContain('blocked by T-0002');
  });

  it('with the blocker in done, the blocked ticket dispatches', async () => {
    h.io.seed('T-0002', 'done');
    h.io.seed('T-0001', 'plan', { depends: ['T-0002'] });
    h.io.seed('T-0003', 'plan');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records.filter((r) => r.info.state === 'running').map((r) => r.request.ticketId)).toEqual(['T-0001', 'T-0003']);
  });

  it('a claim on the blocker changes nothing — only the phase matters', async () => {
    // A store carries no run stamp (the runner's process table, not ticket data): the claim is the stamp.
    h.io.seed('T-0002', 'build', { owner: 'worker@box' });
    h.io.seed('T-0001', 'plan', { depends: ['T-0002'] });
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records).toEqual([]);
  });
});
