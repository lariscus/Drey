import { describe, expect, it } from 'vitest';
import { FakeSystemLoad } from '../ports/system-load.fake';
import { DEFAULT_GOVERNOR_SETTINGS, type GovernorSettings } from '../protocol-governor';
import { Admission } from './admission';
import { ManualClock } from './governor-rig.fake';
import { LoadGuard } from './load-guard';
import { SeatTable } from './seat-table';

function rig(settings: Partial<GovernorSettings> = {}) {
  const load = new FakeSystemLoad();
  const guard = new LoadGuard(load);
  const table = new SeatTable();
  const clock = new ManualClock(new Date(2026, 10, 9, 12, 0));
  const admission = new Admission({ settings: () => ({ ...DEFAULT_GOVERNOR_SETTINGS, ...settings }), table, guard, clock, maxLoadWaitMs: 10 * 60_000 });
  const busy = (n: number): void => {
    for (let i = 0; i < n; i++) {
      table.take('heavy', { runId: `r${i}`, ticket: `T-${i}`, task: 'build', since: '', pid: null });
    }
  };
  return { admission, load, guard, clock, busy };
}

describe('Admission', () => {
  it('grants while seats are free and the load leaves the reserve', () => {
    const r = rig();
    r.guard.sample();
    expect(r.admission.judge(r.clock.now().getTime())).toEqual({ kind: 'grant', note: null });
  });

  it('checks the quiet hours first, then the seats, then the load', () => {
    const r = rig({ quietHours: '11:00 – 13:00', heavySeats: 1 });
    r.busy(1);
    r.load.next = { cpu: 99, memory: 99 };
    r.guard.sample();
    expect(r.admission.judge(0)).toEqual({ kind: 'refused', cause: 'quiet', reason: 'quiet hours until 13:00' });
    r.clock.at = new Date(2026, 10, 9, 13, 0);
    expect(r.admission.judge(r.clock.now().getTime())).toEqual({ kind: 'waits', cause: 'seats', reason: '1 of 1 heavy seats busy' });
  });

  it('refuses above the reserve, and grants after the longest wait only with no heavy seat busy', () => {
    const r = rig();
    r.load.next = { cpu: 91, memory: 20 };
    r.guard.sample();
    const since = r.clock.now().getTime();
    expect(r.admission.judge(since)).toEqual({ kind: 'refused', cause: 'load', reason: 'load 91 % above the reserve' });
    r.clock.advance(10 * 60_000);
    expect(r.admission.judge(since)).toEqual({ kind: 'grant', note: 'after 10 min above the reserve' });
    r.busy(1);
    expect(r.admission.judge(since).kind).toBe('refused');
  });
});
