import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composeShared } from '../compose-supervisor';
import { StoreChainBoard } from '../store-chain-board';
import { ChainBoard } from './chain-board';
import { ChainHarness, PIPELINE } from './chain-harness.fake';
import { ChainState } from './chain-state';
import { CI_BACKOFF_MS, CiSweep } from './ci-sweep';
import type { GateShell } from './gate-runner';

/**
 * The ci handover (M85, req-176): a `handover: ci` column leaves its tickets
 * to an executable check in the work repo — green moves one column right,
 * red backs the ticket off for ten minutes. Each is one `put` through the
 * store door on the rev it read; the chain never stamps a claim. The sweep
 * is driven directly here (awaited, no timer); the last test checks that the
 * orchestrator's scan tick drives it.
 */

const CI_PIPELINE = PIPELINE.replace('  - { id: plan-review, title: Plan review, handover: manual }', '  - { id: plan-review, title: Plan review, handover: ci, ci: npm run check }');

let h: ChainHarness;
let current: Date;
let logs: string[];

/** A sweep over the harness store with the chain On; `shell` is the ci check. */
function sweepWith(shell: GateShell): CiSweep {
  const log = (message: string): void => {
    logs.push(message);
  };
  const state = new ChainState();
  state.config = h.config();
  state.autopilot = { state: 'on' };
  const storeFor = (): never => {
    throw new Error('the chain writes through its store door');
  };
  const now = (): Date => current;
  return new CiSweep({
    state,
    board: new ChainBoard({ doorFor: () => new StoreChainBoard(h.io, log), log }),
    bookkeeper: composeShared(storeFor, log, now).bookkeeper,
    shell,
    clock: { now },
    log,
    pipelineRead: async () => undefined,
    persist: async () => undefined,
  });
}

describe('CiSweep', () => {
  beforeEach(async () => {
    h = new ChainHarness();
    await h.setUp(CI_PIPELINE);
    current = new Date('2026-10-18T12:00:00Z');
    logs = [];
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await h.tearDown();
  });

  it('a green check moves the ticket one column right with one put on the rev it read; no claim is stamped by the chain', async () => {
    h.io.seed('T-0009', 'plan-review');
    const shell = vi.fn<GateShell>(async () => undefined);
    await sweepWith(shell).sweep();

    expect(shell).toHaveBeenCalledWith('npm run check', 'W:/drey');
    expect(h.io.stageOf('T-0009')).toBe('build');
    const writes = h.io.writesTo('T-0009');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.options.expectedRev).toBe(0);
    expect(writes[0]!.text).toMatch(/^stage: build$/m);
    expect(writes[0]!.text).toContain('ci check passed');
    expect(writes[0]!.text).toMatch(/^owner: *$/m); // a claim is dk's and the run's, never the chain's
    expect(logs).toContain('ci moved T-0009 to build');
  });

  it('a red check backs the ticket off — it stays put with a Log line, and the retry waits ten minutes', async () => {
    h.io.seed('T-0009', 'plan-review');
    const shell = vi.fn<GateShell>(async () => {
      throw new Error('exit 1\ncheck failed');
    });
    const sweep = sweepWith(shell);
    await sweep.sweep();

    expect(h.io.stageOf('T-0009')).toBe('plan-review');
    const writes = h.io.writesTo('T-0009');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.text).toMatch(/^stage: plan-review$/m);
    expect(writes[0]!.text).toContain('ci check failed');
    expect(writes[0]!.text).toContain('retry in 10 min');

    // The backoff suppresses the next sweeps' retries until it has run out.
    await sweep.sweep();
    expect(shell).toHaveBeenCalledTimes(1);
    expect(h.io.writesTo('T-0009')).toHaveLength(1);
    current = new Date(current.getTime() + CI_BACKOFF_MS + 1_000);
    await sweep.sweep();
    expect(shell).toHaveBeenCalledTimes(2);
  });

  it("the orchestrator's scan tick drives the sweep", async () => {
    const sweep = vi.spyOn(CiSweep.prototype, 'sweep').mockResolvedValue(undefined);
    const { orch } = h.build({ scanIntervalMs: 5 });
    await orch.configure(h.config()); // a configured chain sweeps even while halted: the check is the column's, not a dispatch
    await vi.waitFor(() => expect(sweep).toHaveBeenCalled(), { timeout: 5_000 });
    orch.dispose();
  });
});
