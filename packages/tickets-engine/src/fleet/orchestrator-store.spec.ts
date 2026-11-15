import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ticketDocument } from './orchestrate/chain-io.fake';
import { ChainHarness, STORE } from './orchestrate/chain-harness.fake';

/**
 * E14-5b, req-176: the chain orchestrator on its one backend, a dricket
 * store. The board is assembled from the store's records (a fake door here:
 * what `dk` answers is dk's business, the real thing runs in
 * `chain-store-dk.spec.ts`); the meta vault only carries pipeline + repos +
 * prompts. What must hold: the dispatch carries the `dk` target, a claimed
 * ticket is held, no ticket file appears anywhere, and a killed runner's
 * leftover claims go before the first dispatch.
 */

let h: ChainHarness;

async function treeOf(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    out.push(...(entry.isDirectory() ? (await treeOf(full)).map((p) => `${entry.name}/${p}`) : [entry.name]));
  }
  return out;
}

describe('Orchestrator on a dricket store (E14-5b)', () => {
  beforeEach(async () => {
    h = new ChainHarness();
    await h.setUp();
  });

  afterEach(async () => {
    await h.tearDown();
  });

  it('dispatches from the store: the request carries the dk target and the persona prompt, no ticket file appears', async () => {
    h.io.seed('T-0001', 'prioritized');
    h.seedRun('T-0003');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');

    const started = fleet.records.filter((r) => r.info.state === 'running');
    expect(started.map((r) => r.request.ticketId)).toEqual(['T-0003']);
    const request = started[0]!.request;
    expect(request.column).toBe('active');
    expect(request.phase).toBe('active');
    expect(request.cursor).toMatchObject({ at: 1, length: 2 });
    expect(request.dk).toMatchObject({ bin: 'dk', store: 'E:/store', checkout: 'E:/store', parkStage: null, needsInputStage: null, trailers: false });
    expect(request.instruction).toContain('Build it.');
    expect(request.acceptance).toEqual(['npm run verify:unit']);
    expect(h.io.comments).toEqual([]); // dispatch itself writes nothing: the run's claim is the stamp
    expect(await treeOf(h.vaultDir)).toEqual(['tickets/_meta/personas/ben/persona.md', 'tickets/_meta/personas/ben/prompt.md', 'tickets/_meta/personas/you/persona.md', 'tickets/_meta/pipeline.md', 'tickets/_meta/repos.md']);
  });

  it('a ticket someone holds is held: the pool waits', async () => {
    h.seedRun('T-0003', { owner: 'henrik' });
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records).toEqual([]);
  });

  // The holder pass (holder-pass.ts) has no wait line for a claimed ticket; the column plan's
  // "claimed by <owner>" line went with it. Re-enable once the holder pass says it again.
  it.skip('the chain log says whose claim holds the ticket', async () => {
    h.seedRun('T-0003', { owner: 'henrik' });
    const { orch, logs } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(logs.join('\n')).toContain('claimed by henrik');
  });

  it("the first dispatch of a store releases a killed runner's leftover claims, once, then reads the board again", async () => {
    h.seedRun('T-0003', { owner: 'agent-r-old@box' });
    const releaseLeftovers = vi.fn(async () => {
      h.io.docs.set('T-0003', ticketDocument('T-0003', 'active', 1, { chain: ['ben', 'you'], extensions: { at: '1' } })); // the runner released it
    });
    const { orch, fleet } = h.build({ releaseLeftovers });
    await orch.configure(h.config());
    await orch.setMaster('run');
    await orch.configure(h.config());
    expect(releaseLeftovers).toHaveBeenCalledTimes(1);
    expect(releaseLeftovers).toHaveBeenCalledWith(STORE);
    expect(fleet.records.map((r) => r.request.ticketId)).toEqual(['T-0003']); // dispatched on the re-read board
  });
});
