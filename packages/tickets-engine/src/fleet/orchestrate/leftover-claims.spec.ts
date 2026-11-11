import { describe, expect, it } from 'vitest';
import { runOwnerId } from '../run-lease';
import { FakeTicketStore } from '../store/ticket-store.fake';
import { settled } from './run-spec-support';
import { buildRequest, DK_TARGET, harness, startRun, useTempDirs } from './supervisor-harness.fake';

const runOwnerHost = (): string => runOwnerId('x').slice('agent-x@'.length);

describe('LeftoverClaims — the claims of this host no live run holds (E14-5b)', () => {
  const dirs = useTempDirs();

  it('release leftover claims: an agent claim of this host with no live run goes back; humans and live runs are left alone', async () => {
    const t = harness(dirs.fleet, {}, new FakeTicketStore());
    const host = runOwnerHost();
    const records = [
      { id: 'T-0007', stage: 'build', owner: `agent-r-dead@${host}` },
      { id: 'T-0008', stage: 'build', owner: 'henrik' },
      { id: 'T-0009', stage: 'build', owner: `agent-r-x@other-host` },
      { id: 'T-0001', stage: 'build', owner: `agent-r-live@${host}` }, // a live run holds T-0001
    ];
    t.store.list = (() => Promise.resolve(records)) as never;
    const id = await startRun(t.sup, buildRequest(dirs.vault, { nextPhase: null, nextPhaseDir: null }));
    const report = await t.sup.releaseLeftoverClaims(DK_TARGET, { build: 'prioritized' });
    expect(report.released).toEqual(['T-0007']);
    const releases = t.store.of('release').filter((c) => c.id === 'T-0007');
    expect(releases[0]?.actor).toBe(`agent-r-dead@${host}`); // released AS the dead run
    expect(releases.map((c) => c.stage)).toEqual(['build', 'prioritized']);
    expect(t.store.of('release').filter((c) => c.id !== 'T-0007')).toHaveLength(0);
    t.adapter.handles[0]!.fail(1);
    await settled(t.sup, id, 'failed');
  });

  it('req-265: on a lifecycle store a leftover claim in running goes to active in one release', async () => {
    const store = new FakeTicketStore();
    store.stages = ['inbox', 'prioritized', 'active', 'running', 'done'];
    store.claimStage = 'running';
    const t = harness(dirs.fleet, {}, store);
    const host = runOwnerHost();
    t.store.list = (() => Promise.resolve([{ id: 'T-0007', stage: 'running', owner: `agent-r-dead@${host}` }])) as never;
    const report = await t.sup.releaseLeftoverClaims({ ...DK_TARGET, retreatStage: null, lifecycle: true }, {});
    expect(report.released).toEqual(['T-0007']);
    expect(t.store.of('release').map((c) => c.stage)).toEqual(['active']);
    expect(t.store.of('put')).toEqual([]);
  });
});
