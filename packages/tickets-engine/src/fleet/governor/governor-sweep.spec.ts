import { describe, expect, it } from 'vitest';
import { GovernorRig, settle } from './governor-rig.fake';

describe('GovernorSweep through the governor', () => {
  it('frees a heavy seat whose process is gone and lets the waiter in', async () => {
    const rig = new GovernorRig();
    rig.settings = { ...rig.settings, heavySeats: 1 };
    (await rig.governor.heavy(rig.ask('r1', 'T-0126'))).adopt(1234);
    let second = false;
    void rig.governor.heavy(rig.ask('r2', 'T-0121', { task: 'build' })).then(() => (second = true));
    rig.processes.dead.add(1234);
    await rig.governor.sweep();
    await settle();
    expect(rig.lines).toContain('governor: stale heavy seat of T-0126 tests released · pid 1234 gone');
    expect(second).toBe(true);
  });

  it('frees a light seat a restart seeded once its worker is gone', async () => {
    const rig = new GovernorRig();
    rig.governor.seed([{ runId: 'r1', ticket: 'T-1', worktree: '/wt/a', pid: 99, devPort: 4301 }]);
    expect(rig.governor.status().light.busy).toBe(1);
    expect(rig.governor.status().devServers).toMatchObject([{ port: 4301, ticket: 'T-1' }]);
    rig.processes.dead.add(99);
    await rig.governor.sweep();
    expect(rig.governor.status().light.busy).toBe(0);
  });

  it('keeps a seat whose process lives and a seat with no pid yet', async () => {
    const rig = new GovernorRig();
    (await rig.governor.heavy(rig.ask('r1'))).adopt(5);
    await rig.governor.heavy(rig.ask('r2'));
    await rig.governor.sweep();
    expect(rig.governor.status().heavy.busy).toBe(2);
  });

  it('seats a dev server listening on a leased port at low priority, and frees it when it stops', async () => {
    const rig = new GovernorRig();
    rig.governor.light(rig.ask('r1', 'T-0126'));
    rig.processes.listeners.set(4300, 8080);
    await rig.governor.sweep();
    expect(rig.lines).toContain('governor: dev server of T-0126 on port 4300 holds a heavy seat · 1 of 2');
    expect(rig.priority.lowered).toEqual([8080]);
    expect(rig.governor.status().devServers).toEqual([{ port: 4300, ticket: 'T-0126', runId: 'r1', listening: true }]);
    expect(rig.governor.status().heavy.holders).toMatchObject([{ task: 'dev server', pid: 8080 }]);
    await rig.governor.sweep();
    expect(rig.governor.status().heavy.busy).toBe(1);
    rig.processes.listeners.delete(4300);
    await rig.governor.sweep();
    expect(rig.lines.at(-1)).toBe('governor: dev server of T-0126 on port 4300 stopped · 0 of 2');
  });

  it('a settled run gives its dev-server seat and port back', async () => {
    const rig = new GovernorRig();
    rig.governor.light(rig.ask('r1', 'T-1'));
    rig.processes.listeners.set(4300, 8080);
    await rig.governor.sweep();
    rig.governor.runSettled('r1');
    expect(rig.governor.status().heavy.busy).toBe(0);
    expect(rig.governor.status().devServers).toEqual([]);
  });
});
