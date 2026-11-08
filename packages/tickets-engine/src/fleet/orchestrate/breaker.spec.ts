import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { failureBackoffMs, RED_COOLDOWN_MS } from './breaker';
import { ChainHarness } from './chain-harness.fake';

/**
 * The circuit breaker (M85, req-176): red gates raise a column's streak and
 * trip it; failures without a verdict back the ticket off and park it after
 * `max-red`. The park is the chain's own write through the store door — one
 * `put` into inbox with the reason in the Log line, plus a `paused:` comment.
 */

let h: ChainHarness;

describe('Breaker', () => {
  beforeEach(async () => {
    h = new ChainHarness();
    await h.setUp();
  });

  afterEach(async () => {
    await h.tearDown();
  });

  it('the circuit breaker trips on three red gates in a row: held column, candidate parked', async () => {
    h.io.seed('T-0001', 'plan');
    let current = new Date('2026-10-18T12:00:00Z');
    const { orch, fleet } = h.build({ now: () => current });
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records).toHaveLength(1);

    // Three red gates: each settle cools the column down; past the
    // cooldown the pass re-dispatches (the fake never moves the
    // ticket), the streak raises, and the third red trips the breaker.
    for (let i = 0; i < 3; i++) {
      const record = fleet.records.find((r) => r.info.state === 'running')!;
      await orch.onRunSettled(fleet.end(record, { state: 'failed', gateFailure: 'gate command failed' }));
      // Past the cooldown the next pass fires again (in production the
      // safety-net timer; here the master flip that always triggers one).
      current = new Date(current.getTime() + Math.max(RED_COOLDOWN_MS, failureBackoffMs(i + 1)) + 1_000);
      if (i < 2) {
        await orch.setMaster('halted');
        await orch.setMaster('run');
      }
    }

    expect(orch.status().columns['plan']).toBe('held');
    expect(orch.status().redStreak['plan']).toBe(3);
    expect(orch.status().tripped?.['plan']?.reason).toBe('3 red gates in a row');
    // The candidate moved to inbox with one put, parked with the reason.
    expect(h.io.stageOf('T-0001')).toBe('inbox');
    const writes = h.io.writesTo('T-0001');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.text).toMatch(/^stage: inbox$/m);
    expect(writes[0]!.text).toContain('parked by the circuit breaker (plan)');
    expect(writes[0]!.text).toContain('3 red gates in a row');
    const comments = h.io.commentsOn('T-0001');
    expect(comments).toHaveLength(1);
    expect(comments[0]!.text).toMatch(/^paused:/);
    expect(comments[0]!.text).toContain('circuit breaker');

    // The owner's play is a fresh start: trip and streak are gone.
    await orch.setColumn('plan', 'playing');
    expect(orch.status().tripped?.['plan']).toBeUndefined();
    expect(orch.status().redStreak['plan']).toBe(0);
  });

  it('a green gate resets the streak; the cooldown only breathes between reds', async () => {
    h.io.seed('T-0001', 'plan');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');

    await orch.onRunSettled(fleet.end(fleet.records[0]!, { state: 'done' }));
    expect(orch.status().redStreak['plan'] ?? 0).toBe(0);
    expect(orch.status().columns['plan'] ?? 'playing').toBe('playing');
  });

  it('a run that fails without a gate verdict backs off per ticket instead of re-dispatching at once', async () => {
    h.io.seed('T-0001', 'plan');
    let current = new Date('2026-10-18T12:00:00Z');
    const { orch, fleet } = h.build({ now: () => current });
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records).toHaveLength(1);

    await orch.onRunSettled(fleet.end(fleet.records[0]!, { state: 'failed', lastError: 'spawn failed' }));
    expect(fleet.records).toHaveLength(1); // still backing off — no hot loop

    current = new Date(current.getTime() + failureBackoffMs(1) + 1_000);
    await orch.setMaster('halted');
    await orch.setMaster('run');
    expect(fleet.records).toHaveLength(2);
  });

  it('repeated non-gate failures park the failing ticket, not the first one in the column', async () => {
    h.io.seed('T-0001', 'plan');
    h.io.seed('T-0002', 'plan');
    let current = new Date('2026-10-18T12:00:00Z');
    const { orch, fleet } = h.build({ now: () => current });
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records.map((r) => r.info.ticketId).sort()).toEqual(['T-0001', 'T-0002']);

    for (let i = 0; i < 3; i++) {
      const record = fleet.records.find((r) => r.info.ticketId === 'T-0002' && r.info.state === 'running')!;
      await orch.onRunSettled(fleet.end(record, { state: 'failed', lastError: 'provider crashed' }));
      current = new Date(current.getTime() + failureBackoffMs(i + 1) + 1_000);
      if (i < 2) {
        await orch.setMaster('halted');
        await orch.setMaster('run');
      }
    }

    expect(h.io.stageOf('T-0002')).toBe('inbox');
    expect(h.io.writesTo('T-0002')[0]!.text).toContain('3 failed runs in a row');
    expect(h.io.commentsOn('T-0002')[0]!.text).toMatch(/^paused:/);
    expect(h.io.stageOf('T-0001')).toBe('plan');
    expect(h.io.writesTo('T-0001')).toEqual([]);
  });
});
