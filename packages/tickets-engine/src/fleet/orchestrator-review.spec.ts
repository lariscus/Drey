import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChainHarness } from './orchestrate/chain-harness.fake';

let h: ChainHarness;

/** req-183: the chain dispatches a review with its own read-only checkout; a builder keeps the worktree. */
describe('Orchestrator — the review step reads its own checkout (req-183)', () => {
  beforeEach(async () => {
    h = new ChainHarness();
    await h.setUp();
    await h.writePersona('rita', { role: 'reviewer', prompt: 'Review it.' });
    await h.writePersona('ralf', { role: 'reviewer', prompt: 'Check it.' });
  });

  afterEach(async () => {
    await h.tearDown();
  });

  it("a reviewer persona's run is dispatched with <id>-review beside its worktree; a builder's run carries none", async () => {
    h.seedRun('T-0001', { persona: 'rita' });
    h.seedRun('T-0002'); // Ben, the builder
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    const byTicket = new Map(fleet.records.map((r) => [r.request.ticketId, r.request]));
    expect(byTicket.get('T-0001')?.reviewCheckout).toBe(path.join(h.vaultDir, '_worktrees', 'T-0001-review'));
    expect(byTicket.get('T-0001')?.worktreePath).toBe(path.join(h.vaultDir, '_worktrees', 'T-0001'));
    expect(byTicket.get('T-0001')?.instruction).toContain('Review checkout:');
    expect(byTicket.get('T-0002')?.reviewCheckout).toBeUndefined();
  });

  it('a gate whose persona is a reviewer reviews in a checkout too', async () => {
    h.seedRun('T-0003', { persona: 'ralf' });
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records.map((r) => r.request.reviewCheckout)).toEqual([path.join(h.vaultDir, '_worktrees', 'T-0003-review')]);
  });
});
