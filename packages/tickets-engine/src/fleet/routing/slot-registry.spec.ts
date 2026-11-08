import { describe, expect, it } from 'vitest';
import type { SlotView } from '../protocol';
import { QuotaRefreshLoop } from './quota-refresh-loop';
import { FakeClock, FakeQuotaSource, slot, window } from './routing.fake';
import type { Slot } from './slot';
import { MIN_FETCH_GAP_MS, SlotRegistry } from './slot-registry';
import { SlotReservations } from './slot-reservations';
import { effectiveWindow, SlotStateResolver } from './slot-state-resolver';
import { slotSummaryOf } from './slot-summary';
import { SurplusCalculator } from './surplus-calculator';

const NOW = new Date('2026-11-09T12:00:00Z');
const inHours = (h: number): string => new Date(NOW.getTime() + h * 3_600_000).toISOString();

interface Rig {
  readonly registry: SlotRegistry;
  readonly source: FakeQuotaSource;
  readonly reservations: SlotReservations;
  readonly clock: FakeClock;
  readonly changes: SlotView[];
  readonly logs: string[];
}

function rig(slots: Slot[]): Rig {
  const source = new FakeQuotaSource();
  const reservations = new SlotReservations();
  const clock = new FakeClock(NOW);
  const changes: SlotView[] = [];
  const logs: string[] = [];
  const registry = new SlotRegistry({
    config: { load: () => Promise.resolve({ slots, errors: [], refreshMs: 60_000 }) },
    sourceOf: () => source,
    reservations,
    resolver: new SlotStateResolver(new SurplusCalculator()),
    clock,
    onChange: (view) => changes.push(view),
    log: (line) => logs.push(line),
  });
  return { registry, source, reservations, clock, changes, logs };
}

const claudeA = slot({ id: 'claude-a', label: 'Claude A', sessions: 2, quota: 'claude-code' });
const zai = slot({ id: 'zai', label: 'z.ai', provider: 'opencode', quota: 'zai' });

describe('SlotRegistry — the slots and what is known of them', () => {
  it('a slot with no readout and no run is unknown; a reading makes it ready, with its windows and q', async () => {
    const { registry, source } = rig([claudeA]);
    await registry.load();
    expect(registry.view('claude-a')).toMatchObject({ state: 'unknown', busy: 0, total: 2, q: null, windows: [] });
    source.readings.set('claude-a', { kind: 'windows', windows: [window({ name: '7d', remaining: 0.62, resetsAt: inHours(84) })] });
    await registry.refresh();
    expect(registry.view('claude-a')).toMatchObject({ state: 'ready', q: 1.24, lastFetch: NOW.toISOString(), lastFetchError: null });
  });

  it('busy n/m while runs hold it; exhausted while a window is spent or rejected', async () => {
    const { registry, source, reservations } = rig([claudeA]);
    await registry.load();
    reservations.reserve('claude-a', 'R-1');
    expect(registry.view('claude-a')).toMatchObject({ state: 'busy', busy: 1, total: 2 });
    source.readings.set('claude-a', { kind: 'windows', windows: [window({ name: '5h', remaining: 0, resetsAt: inHours(2) })] });
    await registry.refresh();
    expect(registry.view('claude-a')).toMatchObject({ state: 'exhausted', reason: `the 5h window is spent until ${inHours(2)}` });
    source.readings.set('claude-a', { kind: 'windows', windows: [window({ name: '5h', remaining: 0.4, rejected: true })] });
    await registry.refresh();
    expect(registry.view('claude-a')?.state).toBe('exhausted');
  });

  it('a spent window past its reset counts as full again, estimated, until the next read', () => {
    const spent = window({ name: '5h', remaining: 0, resetsAt: inHours(-1), rejected: true });
    expect(effectiveWindow(spent, NOW)).toEqual({ name: '5h', spanMs: spent.spanMs, remaining: 1, resetsAt: null, reliability: 'estimated', fetchedAt: null });
  });

  it('a refused login is needs login until cleared, logged once; a remote read that succeeds clears it too', async () => {
    const { registry, source, logs } = rig([zai]);
    await registry.load();
    source.readings.set('zai', { kind: 'login', detail: 'z.ai refused the key (401)' });
    await registry.refresh();
    await registry.refresh(undefined, true);
    expect(registry.view('zai')).toMatchObject({ state: 'needs-login', reason: 'z.ai refused the key (401)', lastFetchError: 'z.ai refused the key (401)' });
    expect(logs.filter((l) => l.includes('needs a login'))).toHaveLength(1);
    source.readings.set('zai', { kind: 'windows', windows: [window()] });
    await registry.refresh(undefined, true);
    expect(registry.view('zai')?.state).toBe('ready');
  });

  it("a counted fallback reading never clears a Claude account's refused login", async () => {
    const { registry, source } = rig([claudeA]);
    await registry.load();
    registry.flagLogin('claude-a', 'authentication_failed');
    source.readings.set('claude-a', { kind: 'windows', windows: [window({ reliability: 'estimated' })] });
    await registry.refresh();
    expect(registry.view('claude-a')?.state).toBe('needs-login');
    registry.clearLogin('claude-a');
    expect(registry.view('claude-a')?.state).toBe('ready');
  });

  it('reads a remote quota at most once a minute unless forced', async () => {
    const { registry, source, clock } = rig([zai, claudeA]);
    await registry.load();
    await registry.refresh();
    await registry.refresh();
    expect(source.reads).toEqual(['zai', 'claude-a', 'claude-a']);
    await registry.refresh('zai', true);
    clock.advance(MIN_FETCH_GAP_MS);
    await registry.refresh('zai');
    expect(source.reads.filter((id) => id === 'zai')).toHaveLength(3);
  });

  it('tells each change once (the slot event), and nothing when nothing changed', async () => {
    const { registry, source, reservations, changes } = rig([claudeA]);
    await registry.load();
    expect(changes.map((v) => v.state)).toEqual(['unknown']);
    registry.announce();
    expect(changes).toHaveLength(1);
    reservations.reserve('claude-a', 'R-1');
    registry.announce();
    source.readings.set('claude-a', { kind: 'windows', windows: [window()] });
    await registry.refresh();
    expect(changes.map((v) => [v.state, v.busy, v.windows.length])).toEqual([
      ['unknown', 0, 0],
      ['busy', 1, 0],
      ['busy', 1, 1],
    ]);
  });

  it('the 7e summary shows the longest window: its share, reliability and reset', async () => {
    const { registry, source } = rig([claudeA]);
    await registry.load();
    source.readings.set('claude-a', { kind: 'windows', windows: [window({ name: '5h', spanMs: 5 * 3_600_000, remaining: 0.78, resetsAt: inHours(2) }), window({ name: '7d', remaining: 0.62, resetsAt: inHours(84) })] });
    await registry.refresh();
    expect(registry.summary()).toEqual([{ id: 'claude-a', label: 'Claude A', profile: 'private', state: 'ready', busy: 0, total: 2, remaining: 0.62, reliability: 'measured', q: 1.24, resetsAt: inHours(84) }]);
    expect(slotSummaryOf({ ...registry.view('claude-a')!, windows: [] })).toMatchObject({ remaining: null, reliability: 'unknown', resetsAt: null });
  });
});

describe('QuotaRefreshLoop — the schedule', () => {
  it('reloads the config and reads every quota each round, then schedules the next; stop ends it', async () => {
    const calls: string[] = [];
    const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
    const registry = { refreshMs: 5_000, load: (): Promise<void> => Promise.resolve(void calls.push('load')), refresh: (): Promise<void> => Promise.resolve(void calls.push('refresh')) };
    const loop = new QuotaRefreshLoop(registry, (fn, ms) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return { cancel: () => (timer.cancelled = true) };
    }, () => undefined);
    loop.start();
    expect(timers.map((t) => t.ms)).toEqual([5_000]);
    timers[0]!.fn();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(['load', 'refresh']);
    expect(timers).toHaveLength(2);
    loop.stop();
    expect(timers[1]!.cancelled).toBe(true);
  });

  it('a failed round is logged and the loop goes on', async () => {
    const logs: string[] = [];
    const loop = new QuotaRefreshLoop({ refreshMs: 1, load: () => Promise.reject(new Error('disk gone')), refresh: () => Promise.resolve() }, () => ({ cancel: () => undefined }), (l) => logs.push(l));
    await loop.tick();
    expect(logs).toEqual(['slot quota refresh failed: disk gone']);
  });
});
