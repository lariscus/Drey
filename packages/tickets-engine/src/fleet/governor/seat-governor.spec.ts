import { describe, expect, it } from 'vitest';
import type { GovernorStatus } from '../protocol-governor';
import { GovernorRig, settle } from './governor-rig.fake';
import type { SeatLease } from './resource-governor';

/** The heavy seats granted so far, in the order they resolved. */
function track(promise: Promise<SeatLease>, into: SeatLease[]): void {
  void promise.then((lease) => into.push(lease));
}

describe('SeatGovernor — heavy seats by count', () => {
  it('grants up to the setting, then the next task waits until a seat frees', async () => {
    const rig = new GovernorRig();
    const granted: SeatLease[] = [];
    track(rig.governor.heavy(rig.ask('r1', 'T-0126')), granted);
    track(rig.governor.heavy(rig.ask('r2', 'T-0127', { task: 'build' })), granted);
    track(rig.governor.heavy(rig.ask('r3', 'T-0121', { task: 'build' })), granted);
    await settle();
    expect(granted).toHaveLength(2);
    expect(rig.lines).toEqual([
      'governor: heavy seat granted to T-0126 tests · 1 of 2',
      'governor: heavy seat granted to T-0127 build · 2 of 2',
      'governor: T-0121 build waits · 2 of 2 heavy seats busy',
    ]);
    expect(rig.governor.status().waiting).toMatchObject([{ ticket: 'T-0121', task: 'build', reason: '2 of 2 heavy seats busy' }]);
    granted[0]!.release();
    await settle();
    expect(granted).toHaveLength(3);
    expect(rig.lines.slice(3)).toEqual(['governor: heavy seat released by T-0126 tests · 1 of 2', 'governor: heavy seat granted to T-0121 build · 2 of 2']);
    expect(rig.governor.status().waiting).toEqual([]);
  });

  it('reads the seat count live: raising it lets a waiter in at the next tick', async () => {
    const rig = new GovernorRig();
    rig.settings = { ...rig.settings, heavySeats: 1 };
    const granted: SeatLease[] = [];
    track(rig.governor.heavy(rig.ask('r1')), granted);
    track(rig.governor.heavy(rig.ask('r2')), granted);
    await settle();
    expect(granted).toHaveLength(1);
    rig.settings = { ...rig.settings, heavySeats: 2 };
    rig.governor.tick();
    await settle();
    expect(granted).toHaveLength(2);
  });

  it('logs a wait once per reason and hands it to the task', async () => {
    const rig = new GovernorRig();
    rig.settings = { ...rig.settings, heavySeats: 1 };
    const reasons: (string | null)[] = [];
    void rig.governor.heavy(rig.ask('r1'));
    const second = rig.governor.heavy({ ...rig.ask('r2', 'T-2'), onWait: (reason) => reasons.push(reason) });
    rig.governor.tick();
    rig.governor.tick();
    expect(rig.lines.filter((line) => line.includes('waits'))).toHaveLength(1);
    expect(reasons).toEqual(['1 of 1 heavy seats busy']);
    rig.table.entries('heavy').forEach((seat) => rig.governor.releaseSeat(seat.id));
    await second;
    expect(reasons).toEqual(['1 of 1 heavy seats busy', null]);
  });

  it('ends the wait of a stopped run with a rejection', async () => {
    const rig = new GovernorRig();
    rig.settings = { ...rig.settings, heavySeats: 1 };
    let stopped = false;
    void rig.governor.heavy(rig.ask('r1'));
    const waiting = rig.governor.heavy({ ...rig.ask('r2', 'T-2'), cancelled: () => stopped });
    stopped = true;
    rig.governor.tick();
    await expect(waiting).rejects.toThrow(/stopped/);
    expect(rig.lines).toContain('governor: T-2 tests no longer waits · the run stopped');
  });
});

describe('SeatGovernor — quiet hours and load', () => {
  it('refuses a heavy start inside the quiet hours (across midnight) and grants after them', async () => {
    const rig = new GovernorRig();
    rig.settings = { ...rig.settings, quietHours: '22:00 – 07:00' };
    rig.clock.at = new Date(2026, 10, 9, 23, 30);
    const granted: SeatLease[] = [];
    track(rig.governor.heavy(rig.ask('r1', 'T-0121', { task: 'build' })), granted);
    await settle();
    expect(granted).toEqual([]);
    expect(rig.lines).toEqual(['governor: T-0121 build refused · quiet hours until 07:00']);
    expect(rig.governor.status().quietUntil).toBe('07:00');
    rig.clock.at = new Date(2026, 10, 10, 7, 0);
    rig.governor.tick();
    await settle();
    expect(granted).toHaveLength(1);
    expect(rig.governor.status().quietUntil).toBeNull();
  });

  it('lets light seats through in the quiet hours', () => {
    const rig = new GovernorRig();
    rig.settings = { ...rig.settings, quietHours: '00:00 – 23:59' };
    rig.governor.light(rig.ask('r1'));
    expect(rig.governor.status().light).toEqual({ busy: 1, total: 6 });
  });

  it('refuses while the load eats into the reserve, and grants when it drops', async () => {
    const rig = new GovernorRig();
    rig.load.next = { cpu: 91, memory: 40 };
    rig.governor.tick();
    const granted: SeatLease[] = [];
    track(rig.governor.heavy(rig.ask('r1', 'T-0126')), granted);
    await settle();
    expect(granted).toEqual([]);
    expect(rig.lines).toEqual(['governor: T-0126 tests refused · load 91 % above the reserve']);
    rig.load.next = { cpu: 30, memory: 40 };
    rig.governor.tick();
    await settle();
    expect(granted).toHaveLength(1);
  });

  it('counts memory as load too', async () => {
    const rig = new GovernorRig();
    rig.load.next = { cpu: 5, memory: 80 };
    rig.governor.tick();
    void rig.governor.heavy(rig.ask('r1', 'T-1'));
    await settle();
    expect(rig.lines).toEqual(['governor: T-1 tests refused · load 80 % above the reserve']);
  });

  it('starts a task anyway after the longest load wait when no heavy seat is busy', async () => {
    const rig = new GovernorRig(60_000);
    rig.load.next = { cpu: 95, memory: 40 };
    rig.governor.tick();
    const granted: SeatLease[] = [];
    track(rig.governor.heavy(rig.ask('r1', 'T-1')), granted);
    rig.clock.advance(60_000);
    rig.governor.tick();
    await settle();
    expect(granted).toHaveLength(1);
    expect(rig.lines.at(-1)).toBe('governor: heavy seat granted to T-1 tests · 1 of 2 · after 1 min above the reserve');
  });
});

describe('SeatGovernor — light seats, ports, priority, status', () => {
  it('gives a light seat the worktree port and the parallelism variables', () => {
    const rig = new GovernorRig();
    const lease = rig.governor.light(rig.ask('r1', 'T-0126'));
    expect(lease.devPort).toBe(4300);
    expect(lease.env).toMatchObject({ DREY_DEV_PORT: '4300', VITEST_MAX_WORKERS: '3' });
    lease.release();
    expect(rig.governor.status().light.busy).toBe(0);
    expect(rig.governor.status().devServers).toEqual([{ port: 4300, ticket: 'T-0126', runId: 'r1', listening: false }]);
    rig.governor.runSettled('r1');
    expect(rig.governor.status().devServers).toEqual([]);
  });

  it('lowers a heavy process when the setting says so, and only then', async () => {
    const rig = new GovernorRig();
    const lease = await rig.governor.heavy(rig.ask('r1'));
    lease.adopt(4242);
    expect(rig.priority.lowered).toEqual([4242]);
    rig.settings = { ...rig.settings, lowPriority: false };
    (await rig.governor.heavy(rig.ask('r2'))).adopt(4343);
    expect(rig.priority.lowered).toEqual([4242]);
    rig.governor.light(rig.ask('r3')).adopt(4444);
    expect(rig.priority.lowered).toEqual([4242]);
  });

  it('says so when the OS refuses the lower priority', async () => {
    const rig = new GovernorRig();
    rig.priority.refuse = true;
    (await rig.governor.heavy(rig.ask('r1', 'T-9'))).adopt(77);
    expect(rig.lines.at(-1)).toBe('governor: could not lower the priority of T-9 tests (pid 77)');
  });

  it('publishes a governor event on each change, not on a repeat', async () => {
    const rig = new GovernorRig();
    const lease = await rig.governor.heavy(rig.ask('r1', 'T-0126'));
    const statuses = rig.events.filter((e) => e.kind === 'governor').map((e) => (e as { governor: GovernorStatus }).governor);
    expect(statuses.at(-1)?.heavy).toMatchObject({ busy: 1, total: 2, holders: [{ ticket: 'T-0126', task: 'tests' }] });
    const count = rig.events.length;
    rig.governor.tick();
    rig.governor.tick();
    expect(rig.events.length).toBe(count + 1); // the first sample changed the load, the second did not
    lease.release();
    expect(rig.events.length).toBe(count + 2);
  });

  it('a second release does nothing', async () => {
    const rig = new GovernorRig();
    const lease = await rig.governor.heavy(rig.ask('r1'));
    lease.release();
    lease.release();
    expect(rig.lines.filter((line) => line.includes('released'))).toHaveLength(1);
  });
});
