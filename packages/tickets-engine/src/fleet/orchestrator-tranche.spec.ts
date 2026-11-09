import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OrchestratorDeps } from './compose-orchestrator';
import { ChainHarness, type Built } from './orchestrate/chain-harness.fake';
import { DEFAULT_TRANCHE, normalizeFleetPools, type ChainConfig, type RunInfo, type TrancheConfig } from './protocol';
import type { RunnerEvent } from './ports/event-sink';

/**
 * The tranche as the Autopilot's release unit (req-179) through the real
 * composition over a fake store and a fake supervisor: On releases a
 * tranche, the dispatcher refuses a start once it is spent, the runner
 * pauses itself with a checkpoint report, On releases the next one, a
 * restart continues the same tranche, an anomaly stops it early.
 */

const PIPELINE = ['---', 'phases:', '  - { id: inbox, title: Inbox, handover: manual }', '  - { id: plan, title: Plan, handover: agent plan-default, worker: opencode }', '  - { id: done, title: Done, handover: none }', '---', ''].join('\n');

const NOON = new Date('2026-11-09T12:00:00Z');

let h: ChainHarness;

function config(tranche: Partial<TrancheConfig> = {}): ChainConfig {
  return h.config({ pools: normalizeFleetPools({ opencode: { size: 1 } }), tranche: { ...DEFAULT_TRANCHE, runs: 2, budgetShare: null, minutes: null, ...tranche } });
}

function build(over: Partial<OrchestratorDeps> = {}): Built & { clock: { now: Date }; events: RunnerEvent[] } {
  const clock = { now: NOON };
  const events: RunnerEvent[] = [];
  const built = h.build({
    now: () => clock.now,
    changeSize: { linesOf: async () => ({ added: 100, removed: 20 }) },
    dayBudget: { limitUsd: () => 15 },
    sink: { publish: (event) => events.push(event) },
    ...over,
  });
  return { ...built, clock, events };
}

/** Ends the live run with a gate verdict and a cost, and tells the chain. */
async function settle(b: Built, gate: 'green' | 'red', costUsd = 0.4): Promise<void> {
  const live = b.fleet.records.find((r) => r.info.state === 'running');
  expect(live).toBeDefined();
  const info: RunInfo = b.fleet.end(live!, { state: gate === 'green' ? 'done' : 'failed', gateResult: gate, costUsd, endedAt: NOON.toISOString() });
  await b.orch.onRunSettled(info);
}

describe('tranches', () => {
  beforeEach(async () => {
    h = new ChainHarness();
    await h.setUp(PIPELINE);
    for (const id of ['T-0001', 'T-0002', 'T-0003', 'T-0004']) {
      h.io.seed(id, 'plan');
    }
  });

  afterEach(async () => {
    await h.tearDown();
  });

  it('On releases tranche 1 and the status carries it', async () => {
    const b = build();
    await b.orch.configure(config());
    const status = await b.orch.setAutopilot({ state: 'on' });
    expect(status.tranche).toMatchObject({ index: 1, done: 1, total: 2, spent: 0, budget: null, endsAt: null, checkpoint: null, report: null });
    expect(b.logs).toContain('tranche 1 released · up to 2 runs');
    expect(b.logs).toContain('tranche 1 of 2 runs · checkpoint in 1 run');
  });

  it('pauses itself at the end of the tranche: the running step finishes, nothing new starts, the report waits', async () => {
    const b = build();
    await b.orch.configure(config());
    await b.orch.setAutopilot({ state: 'on' });
    await settle(b, 'green', 0.4);
    expect(b.fleet.records).toHaveLength(2);
    const paused = b.orch.status();
    expect(paused.autopilot).toEqual({ state: 'paused', reason: 'checkpoint' });
    expect(paused.master).toBe('halted');
    expect(paused.tranche).toMatchObject({ done: 2, checkpoint: 'waiting' });
    await settle(b, 'red', 1.2);
    await b.orch.configure(config()); // a pass
    expect(b.fleet.records).toHaveLength(2);
    expect(b.orch.status().tranche?.report).toMatchObject({ kind: 'end', endedBy: 'runs', runs: 2, spent: 1.6, gates: { green: 1, total: 2 }, change: { added: 100, removed: 20 }, cost: { median: 0.8, max: 1.2 } });
    expect(b.logs.some((line) => line.startsWith('checkpoint: tranche 1 done (runs released) — 2 runs'))).toBe(true);
    expect(await h.chainFile()).toMatchObject({ autopilot: { state: 'paused', reason: 'checkpoint' }, tranche: { index: 1, started: 2 } });
  });

  it('Release next tranche (On) opens tranche 2 and dispatches', async () => {
    const b = build();
    await b.orch.configure(config());
    await b.orch.setAutopilot({ state: 'on' });
    await settle(b, 'green');
    await settle(b, 'green');
    const released = await b.orch.setAutopilot({ state: 'on' });
    expect(released.autopilot).toEqual({ state: 'on' });
    expect(released.tranche).toMatchObject({ index: 2, done: 1, checkpoint: null });
    expect(b.fleet.records).toHaveLength(3);
  });

  it('a Paused set while the checkpoint waits keeps the reason', async () => {
    const b = build();
    await b.orch.configure(config({ runs: 1 }));
    await b.orch.setAutopilot({ state: 'on' });
    const status = await b.orch.setAutopilot({ state: 'paused', resumeAt: '2026-11-09T18:00:00.000Z' });
    expect(status.autopilot).toEqual({ state: 'paused', resumeAt: '2026-11-09T18:00:00.000Z', reason: 'checkpoint' });
  });

  it('a restart continues the same tranche: the counters come back from chain.json', async () => {
    const first = build();
    await first.orch.configure(config({ runs: 3 }));
    await first.orch.setAutopilot({ state: 'on' });
    await settle(first, 'green', 0.5);
    first.orch.dispose();

    const second = build();
    await second.orch.load();
    await second.orch.configure(config({ runs: 3 }));
    expect(second.orch.status().autopilot).toEqual({ state: 'off' }); // the boot rule
    expect(second.orch.status().tranche).toMatchObject({ index: 1, done: 2, spent: 0.5 });
    const on = await second.orch.setAutopilot({ state: 'on' });
    expect(on.tranche).toMatchObject({ index: 1, done: 3 }); // the same tranche goes on: its third and last run
  });

  it('the time span ends the tranche on the next pass', async () => {
    const b = build();
    await b.orch.configure(config({ runs: null, minutes: 60 }));
    await b.orch.setAutopilot({ state: 'on' });
    expect(b.orch.status().tranche?.endsAt).toBe('2026-11-09T13:00:00.000Z');
    b.clock.now = new Date('2026-11-09T13:00:00Z');
    await settle(b, 'green');
    expect(b.fleet.records).toHaveLength(1);
    expect(b.orch.status().tranche).toMatchObject({ checkpoint: 'waiting', report: { endedBy: 'time', minutes: 60 } });
  });

  it('the budget share ends the tranche once the settled runs spent it', async () => {
    const b = build();
    await b.orch.configure(config({ runs: null, budgetShare: 0.1 }));
    await b.orch.setAutopilot({ state: 'on' });
    expect(b.orch.status().tranche).toMatchObject({ budget: 1.5, of: 10 });
    await settle(b, 'green', 1.6);
    expect(b.orch.status().tranche).toMatchObject({ checkpoint: 'waiting', report: { endedBy: 'budget', spent: 1.6 } });
    expect(b.fleet.records).toHaveLength(1);
  });

  it('stops early on an anomaly; Release anyway goes on with the same tranche', async () => {
    const b = build();
    await b.orch.configure(config({ runs: 10, earlyStop: { ...DEFAULT_TRANCHE.earlyStop, redGates: 2, gateWindow: 3, sameTicketRed: null } }));
    await b.orch.setAutopilot({ state: 'on' });
    await settle(b, 'red');
    await settle(b, 'red');
    const stopped = b.orch.status();
    expect(stopped.autopilot).toEqual({ state: 'paused', reason: 'checkpoint' });
    expect(stopped.tranche?.report).toMatchObject({ kind: 'early', earlyStop: { rule: 'gate_rate', red: 2, window: 2, runsLeft: 8 } });
    expect(b.logs.some((line) => line.startsWith('stopped early: 2 of the last 2 gates were red — the tranche had 8 runs left'))).toBe(true);
    const again = await b.orch.setAutopilot({ state: 'on' });
    expect(again.tranche).toMatchObject({ index: 1, done: 3, checkpoint: null });
  });

  it('publishes the tranche on the event stream when it changes', async () => {
    const b = build();
    await b.orch.configure(config());
    await b.orch.setAutopilot({ state: 'on' });
    const tranches = b.events.filter((event) => event.kind === 'tranche');
    expect(tranches.length).toBeGreaterThan(0);
    expect(tranches.at(-1)).toMatchObject({ kind: 'tranche', tranche: { index: 1, done: 1 } });
  });

  it('runs without tranches when every limit is off', async () => {
    const b = build();
    await b.orch.configure(config({ runs: null }));
    const status = await b.orch.setAutopilot({ state: 'on' });
    expect(status.tranche).toBeUndefined();
    await settle(b, 'green');
    await settle(b, 'green');
    await settle(b, 'green');
    expect(b.fleet.records).toHaveLength(4);
  });
});
