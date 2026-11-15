import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeFleetPools } from '../protocol';
import { ChainHarness } from '../chain/chain-harness.fake';

/**
 * The provider pools' capacity right now (req-63): a probed server caps a
 * pool, a spent quota pauses the provider, a rate limit shrinks its pool —
 * read off settled runs by the real composition over a fake dricket store.
 */

let h: ChainHarness;

describe('PoolCapacity', () => {
  beforeEach(async () => {
    h = new ChainHarness();
    await h.setUp();
  });

  afterEach(async () => {
    await h.tearDown();
  });

  it('a probed llama.cpp server caps the pool (req-63)', async () => {
    h.seedRun('T-0001');
    h.seedRun('T-0002');
    const probeSlots = vi.fn(async (): Promise<number | null> => 1);
    const { orch, fleet, logs } = h.build({ probeSlots });
    await orch.configure(h.config({ pools: normalizeFleetPools({ opencode: { size: 4, probeUrl: 'http://127.0.0.1:8080' } }) }));
    await orch.setMaster('run');
    expect(probeSlots).toHaveBeenCalledWith('http://127.0.0.1:8080');
    expect(fleet.records).toHaveLength(1);
    expect(logs.some((line) => line.includes('runs 1 parallel slot'))).toBe(true);
  });

  it('a run out of quota pauses its provider pool — no new run, no red gate', async () => {
    h.seedRun('T-0001');
    h.seedRun('T-0002');
    h.seedRun('T-0003');
    const { orch, fleet, logs } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records).toHaveLength(2);
    await orch.onRunSettled(fleet.end(fleet.records[0]!, { state: 'failed', lastError: 'provider.quota 429: Usage limit reached for 5 hour.' }));
    expect(logs.some((line) => line.includes('opencode is out of quota'))).toBe(true);
    expect(logs.some((line) => line.includes('red gate'))).toBe(false);
    expect(fleet.records).toHaveLength(2);
    // The board reads the pause off the status (chain alerts fix).
    expect(Object.keys(orch.status().quotaPausedUntil ?? {})).toEqual(['opencode']);
    // The capacity line (E12-4): a provider paused for its quota carries no pool; the other keeps its size.
    expect(orch.status().poolSize?.['opencode']).toBe(0);
    expect(orch.status().poolSize?.['claude-code']).toBeGreaterThanOrEqual(1);
  });

  it('a rate-limited run shrinks its provider pool for a while (req-63)', async () => {
    h.seedRun('T-0001');
    h.seedRun('T-0002');
    h.seedRun('T-0003');
    const { orch, fleet, logs } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records).toHaveLength(2);
    await orch.onRunSettled(fleet.end(fleet.records[0]!, { state: 'failed', lastError: 'prompt failed: 429' }));
    expect(logs.some((line) => line.includes('opencode hit its rate limit'))).toBe(true);
    // two slots minus the shrink = one, and one run is still live — nothing new starts
    expect(fleet.records.filter((r) => r.info.state === 'running')).toHaveLength(1);
  });
});
