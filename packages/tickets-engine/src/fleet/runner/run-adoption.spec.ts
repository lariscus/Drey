import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunRequest } from '../protocol';
import { probeExec } from './shell-exec';
import { settled, waitFor } from './run-spec-support';
import { harness, planStore, runInfo, runRequest, startRun, useTempDirs, writeRecord } from './supervisor-harness.fake';

describe('RunAdoption — the runs a restarted runner finds', () => {
  const dirs = useTempDirs();
  const request = (over: Partial<RunRequest> = {}): RunRequest => runRequest(dirs.vault, over);

  it('an adopted run detached mid-busy is frozen at its last stamp', async () => {
    const info = runInfo({ id: 'R-ex', startedAt: '2026-10-17T10:00:00Z', sessionRef: 'ses_ex', lastActivity: '2026-10-17T11:30:00Z', turn: 'busy', execMs: 30 * 60_000, execSince: '2026-10-17T11:00:00Z' });
    await writeRecord(dirs.fleet, { request: request(), info });
    const { sup } = harness(dirs.fleet);
    await sup.adopt();
    expect(sup.get('R-ex')).toMatchObject({ execMs: 60 * 60_000, execSince: null });
  });

  it('a re-attached busy run resumes its clock at the next busy report, without the unwatched gap', async () => {
    const info = runInfo({ id: 'R-busy', pid: process.pid, sessionRef: 'ses_busy', lastActivity: '2026-10-17T11:30:00Z', turn: 'busy', execMs: 20 * 60_000, execSince: '2026-10-17T11:10:00Z' });
    await writeRecord(dirs.fleet, { request: request(), info }, { address: 'http://127.0.0.1:50003', password: 'pw', pid: process.pid, pidStartedMs: null });
    const { sup, adapter } = harness(dirs.fleet, { exec: probeExec(os.tmpdir()) });
    await sup.adopt();
    // The unwatched gap closed the span at the record's last stamp.
    expect(sup.get('R-busy')).toMatchObject({ execMs: 40 * 60_000, execSince: null });

    adapter.starts[0]!.onEvent({ ts: '2026-10-17T12:05:00Z', kind: 'usage', turn: 'busy' });
    await waitFor(() => expect(sup.get('R-busy')?.execSince).toBe('2026-10-17T12:05:00Z'));
    expect(sup.get('R-busy')?.execMs).toBe(40 * 60_000);
  });

  it('re-attaches a live worker of a restarted runner, a held run stays held', async () => {
    const info = runInfo({ id: 'R-live', held: true, pid: process.pid, sessionRef: 'ses_live', tokensIn: 5, tokensOut: 1, lastActivity: '2026-10-17T11:30:00Z' });
    // the worker is "alive": the recorded process is this very test process
    const dir = await writeRecord(dirs.fleet, { request: request(), info }, { address: 'http://127.0.0.1:50001', password: 'pw', pid: process.pid, pidStartedMs: null });

    const { sup, adapter } = harness(dirs.fleet, { exec: probeExec(os.tmpdir()) });
    await sup.adopt();

    expect(sup.get('R-live')?.state).toBe('running');
    expect(adapter.attachInfos).toHaveLength(1);
    expect(adapter.attachInfos[0]).toMatchObject({ address: 'http://127.0.0.1:50001', password: 'pw', sessionRef: 'ses_live', pid: process.pid });
    expect(adapter.handles[0]!.setHold).toHaveBeenCalledWith(true);
    // the credential never rides in the run record the board reads
    expect(await fsp.readFile(path.join(dir, 'run.json'), 'utf8')).not.toContain('pw"');
  });

  it('does not re-attach when the recorded process is gone or no attach file exists', async () => {
    const dead = { address: 'http://127.0.0.1:50002', password: 'pw', pid: 2_147_483_000, pidStartedMs: null };
    await writeRecord(dirs.fleet, { request: request(), info: runInfo({ id: 'R-nofile', sessionRef: 'ses_x' }) });
    await writeRecord(dirs.fleet, { request: request(), info: runInfo({ id: 'R-dead', sessionRef: 'ses_x' }) }, dead);
    const { sup, adapter } = harness(dirs.fleet, { exec: probeExec(os.tmpdir()) });
    await sup.adopt();
    expect(adapter.attachInfos).toHaveLength(0);
    expect(sup.get('R-nofile')?.state).toBe('detached');
    expect(sup.get('R-dead')?.state).toBe('detached');
  });

  it('adopts a live leftover as detached once, and stop ends a detached run (frees the ticket)', async () => {
    const dir = await writeRecord(dirs.fleet, { request: request(), info: runInfo({ id: 'R-old' }) });

    const first = harness(dirs.fleet);
    await first.sup.adopt();
    expect(first.sup.get('R-old')?.state).toBe('detached');

    // A second boot leaves the detached record alone (no re-detach, no new stamp).
    const before = await fsp.readFile(path.join(dir, 'run.json'), 'utf8');
    const second = harness(dirs.fleet);
    await second.sup.adopt();
    expect(await fsp.readFile(path.join(dir, 'run.json'), 'utf8')).toBe(before);

    const stopped = await second.sup.stop('R-old', 'owner');
    expect(stopped.ok).toBe(true);
    expect(second.sup.get('R-old')?.state).toBe('stopped');
  });

  it('a runner restart marks live runs detached and frees the ticket', async () => {
    const store = planStore();
    const first = harness(dirs.fleet, {}, store);
    const id = await startRun(first.sup, request());
    // The first supervisor "crashes" without the worker ever exiting.

    const second = harness(dirs.fleet, {}, store);
    await second.sup.adopt();
    expect(second.sup.get(id)?.state).toBe('detached');
    // req-176: the ticket is freed through the store (it was the cleared file stamp).
    expect(store.of('release')).toHaveLength(1);
    expect(store.of('comment').at(-1)?.text).toContain('the runner restarted');
  });

  describe('a record from before the cut-over (D-42)', () => {
    it('the boot writes no ticket and touches no store', async () => {
      const { dk: _none, ...legacy } = request();
      const info = runInfo({ id: 'R-frozen', pid: 70832, sessionRef: 'ses_frozen', lastActivity: '2026-10-17T11:20:00Z' });
      await writeRecord(dirs.fleet, { request: legacy, info });
      const { sup, store } = harness(dirs.fleet, { exec: async () => 'INFO: No tasks' });
      await sup.adopt();
      expect(sup.get('R-frozen')?.state).toBe('detached');
      await sup.reap();
      await settled(sup, 'R-frozen', 'failed');
      expect(store.calls).toEqual([]);
      expect(await fsp.readdir(dirs.vault)).toEqual([]);
    });
  });
});
