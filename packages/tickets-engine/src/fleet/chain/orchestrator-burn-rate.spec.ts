import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChainHarness, type Built } from './chain-harness.fake';
import type { DispatchPool } from './dispatch-pool';
import { PoolRig } from '../routing/pool.fake';
import { normalizeFleetPools, type RunInfo } from '../protocol';
import type { RunnerEvent } from '../ports/event-sink';
import { BurnRateRig, slotView, week } from '../routing/burn-rate.fake';

/**
 * The burn rate through the real composition (req-181) over a fake store
 * and a fake supervisor, with the real meter, guard and hold source: the
 * dispatcher refuses a start once today's share is reached, the running
 * step finishes, the status carries the hold and the event stream tells it,
 * the owner's lift dispatches at once, the day turning releases the chain.
 */

const EVENING = new Date('2026-11-09T22:00:00Z');

let h: ChainHarness;

interface Rigged extends Built {
  readonly burn: BurnRateRig;
  readonly events: RunnerEvent[];
}

function build(): Rigged {
  const burn = new BurnRateRig(EVENING);
  const events: RunnerEvent[] = [];
  const pool: DispatchPool = { ...new PoolRig([], EVENING).dispatchPool(), sessionsOf: () => 1, hold: burn.source };
  const built = h.build({ now: () => burn.clock.now(), pool, sink: { publish: (event) => events.push(event) }, log: (line) => burn.logs.push(line) });
  return { ...built, logs: burn.logs, burn, events };
}

/** Today's weekly window of the one slot went from 90 % to 90 % − `share`. */
function spend(b: Rigged, share: number): void {
  b.burn.see([slotView('claude-a', [week(0.9)])]);
  b.burn.see([slotView('claude-a', [week(0.9 - share)])]);
}

async function settle(b: Built): Promise<void> {
  const live = b.fleet.records.find((r) => r.info.state === 'running');
  expect(live).toBeDefined();
  const info: RunInfo = b.fleet.end(live!, { state: 'done', gateResult: 'green', costUsd: 0.4, endedAt: EVENING.toISOString() });
  await b.orch.onRunSettled(info);
}

describe('the burn rate holds new starts (req-181)', () => {
  beforeEach(async () => {
    h = new ChainHarness();
    await h.setUp();
    // One step at a time (the persona's own `parallel:`): with the capacity pool wired, a persona's card counts against no provider pool.
    await h.write('tickets/_meta/personas/ben/persona.md', ['---', 'title: ben', 'role: builder', 'worker: opencode', 'models:', '  default: opus', '  pool: [opus]', 'parallel: 1', '---', ''].join('\n'));
    for (const id of ['T-0001', 'T-0002', 'T-0003']) {
      h.seedRun(id);
    }
  });

  afterEach(async () => {
    await h.tearDown();
  });

  it('under the limit the chain dispatches and the status says nothing holds', async () => {
    const b = build();
    spend(b, 0.1);
    await b.orch.configure(h.config({ pools: normalizeFleetPools({ opencode: { size: 1 } }) }));
    const status = await b.orch.setAutopilot({ state: 'on' });
    expect(status.hold).toBeNull();
    expect(b.fleet.records).toHaveLength(1);
  });

  it('reached: the running step finishes, nothing new starts, the Autopilot stays On and the status carries the reason', async () => {
    const b = build();
    await b.orch.configure(h.config({ pools: normalizeFleetPools({ opencode: { size: 1 } }) }));
    await b.orch.setAutopilot({ state: 'on' });
    expect(b.fleet.records).toHaveLength(1);
    spend(b, 0.21);
    await settle(b);
    expect(b.fleet.records).toHaveLength(1);
    const status = b.orch.status();
    expect(status.autopilot).toEqual({ state: 'on' });
    expect(status.hold).toEqual({ reason: 'burn-rate', spent: 0.21, limit: 0.2, resumesAt: '2026-11-10T00:00:00.000Z', basis: 'measured', since: '2026-11-09T22:00:00.000Z' });
    expect(b.logs).toContain('route refused · burn rate 21 % of 20 % today · resumes 00:00');
    expect(b.events.filter((e) => e.kind === 'hold')).toEqual([{ kind: 'hold', hold: status.hold }]);
  });

  it('Allow today once dispatches at once and holds nothing more today', async () => {
    const b = build();
    spend(b, 0.3);
    await b.orch.configure(h.config({ pools: normalizeFleetPools({ opencode: { size: 1 } }) }));
    await b.orch.setAutopilot({ state: 'on' });
    expect(b.fleet.records).toHaveLength(0);
    const lifted = await b.orch.liftHold();
    expect(lifted.hold).toBeNull();
    expect(b.fleet.records).toHaveLength(1);
    expect(b.events.filter((e) => e.kind === 'hold').map((e) => (e.kind === 'hold' ? e.hold?.reason ?? null : 'x'))).toEqual(['burn-rate', null]);
    expect(b.logs).toContain('burn rate: allowed for the rest of today by the owner');
  });

  it('the day turning releases the chain on the next pass', async () => {
    const b = build();
    spend(b, 0.3);
    await b.orch.configure(h.config({ pools: normalizeFleetPools({ opencode: { size: 1 } }) }));
    await b.orch.setAutopilot({ state: 'on' });
    expect(b.fleet.records).toHaveLength(0);
    b.burn.clock.advance(3 * 3_600_000);
    await b.orch.configure(h.config({ pools: normalizeFleetPools({ opencode: { size: 1 } }) })); // a pass
    expect(b.fleet.records).toHaveLength(1);
    expect(b.orch.status().hold).toBeNull();
    expect(b.logs).toContain('burn rate: the hold cleared — new runs start again');
  });

  it('a lift with the Autopilot Off changes the day, starts nothing', async () => {
    const b = build();
    spend(b, 0.3);
    await b.orch.configure(h.config({ pools: normalizeFleetPools({ opencode: { size: 1 } }) }));
    expect((await b.orch.liftHold()).hold).toBeNull();
    expect(b.fleet.records).toHaveLength(0);
  });
});
