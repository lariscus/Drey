import { describe, expect, it } from 'vitest';
import type { RunnerEvent } from '../ports/event-sink';
import { FakeSystemLoad } from '../ports/system-load.fake';
import type { GovernorStatus } from '../protocol-governor';
import { GovernorPublisher } from './governor-publisher';
import { GovernorTicker, type GovernorTimers } from './governor-timers';
import { heavyTaskOf } from './heavy-task';
import { LoadGuard } from './load-guard';
import { SeatTable } from './seat-table';

const holder = (runId: string) => ({ runId, ticket: runId, task: 'tests' as const, since: '2026-11-09T12:00:00.000Z', pid: null });

describe('SeatTable', () => {
  it('counts seats per class and records who holds them', () => {
    const table = new SeatTable();
    const a = table.take('heavy', holder('r1'));
    table.take('light', holder('r2'));
    table.setPid(a, 42);
    expect(table.busy('heavy')).toBe(1);
    expect(table.busy('light')).toBe(1);
    expect(table.holders('heavy')).toMatchObject([{ runId: 'r1', pid: 42 }]);
  });

  it('releases once', () => {
    const table = new SeatTable();
    const a = table.take('heavy', holder('r1'));
    expect(table.release(a)?.holder.runId).toBe('r1');
    expect(table.release(a)).toBeNull();
    expect(table.has(a)).toBe(false);
  });
});

describe('LoadGuard', () => {
  it('refuses nothing before the first sample or with no reserve', () => {
    const load = new FakeSystemLoad();
    const guard = new LoadGuard(load);
    expect(guard.verdict(25)).toEqual({ ok: true });
    load.next = { cpu: 99, memory: 99 };
    guard.sample();
    expect(guard.verdict(0)).toEqual({ ok: true });
  });

  it('refuses when CPU or memory passes 100 minus the reserve', () => {
    const load = new FakeSystemLoad();
    const guard = new LoadGuard(load);
    load.next = { cpu: 75, memory: 75 };
    guard.sample();
    expect(guard.verdict(25)).toEqual({ ok: true });
    load.next = { cpu: 76, memory: 10 };
    guard.sample();
    expect(guard.verdict(25)).toEqual({ ok: false, load: 76 });
    load.next = { cpu: null, memory: 80 };
    guard.sample();
    expect(guard.verdict(25)).toEqual({ ok: false, load: 80 });
  });
});

describe('heavyTaskOf', () => {
  it('names tests, builds and other commands', () => {
    expect(heavyTaskOf('npm test')).toBe('tests');
    expect(heavyTaskOf('npx vitest run src')).toBe('tests');
    expect(heavyTaskOf('npm run e2e:run -- smoke')).toBe('tests');
    expect(heavyTaskOf('npm run build')).toBe('build');
    expect(heavyTaskOf('node node_modules/typescript/bin/tsc -p x --noEmit')).toBe('build');
    expect(heavyTaskOf('node scripts/check-cycles.mjs')).toBe('command');
  });
});

class ManualTimers implements GovernorTimers {
  readonly armed = new Map<number, () => void>();
  every(ms: number, fn: () => void): () => void {
    this.armed.set(ms, fn);
    return () => this.armed.delete(ms);
  }
}

describe('GovernorTicker', () => {
  it('ticks once at start, then on both periods, until stopped', async () => {
    const timers = new ManualTimers();
    const calls: string[] = [];
    const ticker = new GovernorTicker(timers, { tickMs: 5_000, sweepMs: 30_000 });
    ticker.start({ tick: () => calls.push('tick'), sweep: () => Promise.resolve(void calls.push('sweep')) });
    timers.armed.get(5_000)?.();
    timers.armed.get(30_000)?.();
    await Promise.resolve();
    expect(calls).toEqual(['tick', 'tick', 'sweep']);
    ticker.stop();
    expect(timers.armed.size).toBe(0);
  });
});

const status = (busy: number): GovernorStatus => ({
  heavy: { busy, total: 2, holders: [] },
  light: { busy: 0, total: null },
  load: { cpu: null, memory: null, reserve: 25 },
  lowPriority: true,
  quietHours: '',
  quietUntil: null,
  waiting: [],
  devServers: [],
});

describe('GovernorPublisher', () => {
  it('prefixes the log line and publishes a changed status once', () => {
    const lines: string[] = [];
    const events: RunnerEvent[] = [];
    const publisher = new GovernorPublisher((line) => lines.push(line), { publish: (event) => events.push(event) });
    publisher.line('heavy seat granted to T-0126 tests · 1 of 2');
    publisher.status(status(1));
    publisher.status(status(1));
    publisher.status(status(2));
    expect(lines).toEqual(['governor: heavy seat granted to T-0126 tests · 1 of 2']);
    expect(events.map((e) => (e.kind === 'governor' ? e.governor.heavy.busy : -1))).toEqual([1, 2]);
  });
});
