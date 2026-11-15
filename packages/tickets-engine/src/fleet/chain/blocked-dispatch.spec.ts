import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChainHarness } from './chain-harness.fake';

/**
 * The fleet respects blocked-by (T-0050): the real orchestrator over a fake
 * dricket store (a blocker is a `depends:` entry) and a fake supervisor
 * port — a blocked ticket is never dispatched to its holder; the chain log
 * says why.
 */

let h: ChainHarness;

describe('the fleet respects blocked-by (T-0050)', () => {
  beforeEach(async () => {
    h = new ChainHarness();
    await h.setUp();
  });

  afterEach(async () => {
    await h.tearDown();
  });

  it('a pass starts only the free ticket, never the blocked one', async () => {
    h.io.seed('T-0002', 'prioritized'); // the blocker — nowhere near done
    // The blocked ticket sorts ABOVE the free one (the id tiebreak).
    h.seedRun('T-0001', { depends: ['T-0002'] });
    h.seedRun('T-0003');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');

    const started = fleet.records.filter((r) => r.info.state === 'running');
    expect(started.map((r) => r.request.ticketId)).toEqual(['T-0003']);
  });

  it('with the blocker in done, the blocked ticket dispatches', async () => {
    h.io.seed('T-0002', 'done');
    h.seedRun('T-0001', { depends: ['T-0002'] });
    h.seedRun('T-0003');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records.filter((r) => r.info.state === 'running').map((r) => r.request.ticketId)).toEqual(['T-0001', 'T-0003']);
  });

  it('a claim on the blocker changes nothing — only the phase matters', async () => {
    // A store carries no run stamp (the runner's process table, not ticket data): the claim is the stamp.
    h.io.seed('T-0002', 'prioritized', { owner: 'worker@box' });
    h.seedRun('T-0001', { depends: ['T-0002'] });
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records).toEqual([]);
  });
});
