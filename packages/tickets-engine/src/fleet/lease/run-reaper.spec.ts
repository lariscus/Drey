import { describe, expect, it } from 'vitest';
import type { RunInfo, RunRequest } from '../protocol';
import { STUCK_FAIL_MS, STUCK_FLAG_MS } from './run-reaper';
import { settled } from '../runner/run-spec-support';
import { aliveProbe, harness, harnessWith, liveRun, runInfo, runnerNotes, runRequest, startRun, storedRecord, useTempDirs, writeRecord } from '../runner/supervisor-harness.fake';

describe('RunReaper — the hang watchdog, the run limits and the context cap', () => {
  const dirs = useTempDirs();
  const request = (over: Partial<RunRequest> = {}): RunRequest => runRequest(dirs.vault, over);

  it('the watchdog flags a silent worker, then fails it so the ticket backs off (M1b)', async () => {
    let current = new Date('2026-10-17T12:00:00Z');
    const { sup } = harness(dirs.fleet, { now: () => current, exec: aliveProbe });
    const id = await startRun(sup, request());

    current = new Date(current.getTime() + STUCK_FLAG_MS + 60_000);
    await sup.reap();
    expect(sup.get(id)!.stuck).toBe(true);
    expect(sup.get(id)!.state).toBe('running');

    current = new Date(current.getTime() + STUCK_FAIL_MS);
    await sup.reap();
    expect(sup.get(id)!.state).toBe('failed');
    expect(sup.get(id)!.lastError).toContain('hung');
  });

  it('a reaped run settles once, although stopping its worker also fires the exit handler (D-4)', async () => {
    let current = new Date('2026-10-17T12:00:00Z');
    const settles: string[] = [];
    const { sup, store } = harness(dirs.fleet, { now: () => current, exec: aliveProbe, onRunSettled: (info) => void settles.push(info.id) });
    const id = await startRun(sup, request());

    current = new Date(current.getTime() + STUCK_FLAG_MS + STUCK_FAIL_MS + 60_000);
    await sup.reap();
    await settled(sup, id, 'failed');
    // Let a second (exit-handler) settle, if one were running, finish too.
    await sup.idle();
    expect(settles).toEqual([id]);
    // req-176: the one hand-back is the store's release (it was the ticket commit), and only one:
    // refused in the claim stage, back where the ticket sat — a lifecycle stage (R-31).
    expect(store.of('release').map((c) => c.stage)).toEqual(['plan', 'active']);
    expect(store.of('comment').filter((c) => (c.text ?? '').startsWith('failed:'))).toHaveLength(1);
    expect((await runnerNotes(dirs.fleet, id)).some((line) => line.startsWith('hung:'))).toBe(true);
  });

  it('the reaper stops a run past its turn limit', async () => {
    const { sup } = harness(dirs.fleet, { limits: { maxTurns: 5 } });
    const id = await startRun(sup, request());
    const live = liveRun(sup, id);
    live.info = { ...live.info, turns: 6 };
    await sup.reap();
    expect(sup.get(id)!.state).toBe('failed');
    expect(sup.get(id)!.lastError).toContain('run limit');
  });

  /** A run of `provider` whose context is past the cap, reaped once. */
  async function reapPastCap(provider: 'claude-code' | 'opencode'): Promise<RunInfo> {
    const { sup } = harnessWith(dirs.fleet, { id: provider }, { exec: aliveProbe });
    const id = await startRun(sup, request({ provider }));
    const live = liveRun(sup, id);
    live.info = { ...live.info, lastTurnContext: 170_000 };
    await sup.reap();
    return sup.get(id)!;
  }

  it('the reaper ends a claude-code run past the context cap', async () => {
    const info = await reapPastCap('claude-code');
    expect(info.state).toBe('failed');
    expect(info.lastError).toContain('context cap: 170000 tokens');
  });

  it('an OpenCode run past the cap is left alone — it compacts its own session', async () => {
    const info = await reapPastCap('opencode');
    expect(info.state).toBe('running');
  });

  it("the column's own max-turns beats the runner default", async () => {
    const { sup } = harness(dirs.fleet);
    const id = await startRun(sup, request({ limits: { maxTurns: 3 } }));
    const live = liveRun(sup, id);
    live.info = { ...live.info, turns: 4 }; // far under the default 250, over the column's 3
    await sup.reap();
    expect(sup.get(id)!.state).toBe('failed');
    expect(sup.get(id)!.lastError).toContain('4 turns, over the limit of 3');
  });

  describe('a detached run whose worker is gone (D-34)', () => {
    /** Answers the liveness probes: only the pids named are running, started at the given instant. */
    const running =
      (pids: Readonly<Record<number, string>>) =>
      async (cmd: string, args: readonly string[]): Promise<string> => {
        const pid = Number(/\d+/.exec(args.join(' '))?.[0] ?? '0');
        if (cmd === 'powershell.exe') {
          const started = pids[pid];
          if (started === undefined) {
            throw new Error('gone');
          }
          return String(Date.parse(started));
        }
        if (pids[pid] === undefined) {
          if (cmd === 'tasklist') {
            return 'INFO: No tasks';
          }
          throw new Error('gone');
        }
        return cmd === 'ps' ? new Date(pids[pid]!).toUTCString() : `"${pid}"`;
      };

    async function seedDetached(pid: number): Promise<void> {
      const info = runInfo({
        id: 'R-old',
        state: 'detached',
        pid,
        endedAt: '2026-10-17T11:30:00Z',
        sessionRef: 'ses_old',
        lastActivity: '2026-10-17T11:20:00Z',
        gateFailure: 'the runner restarted while the worker lived on; watch or resume it manually',
      });
      await writeRecord(dirs.fleet, { request: request(), info });
    }

    it('settles at the reaper: the fleet stops counting it', async () => {
      await seedDetached(70832);
      const { sup } = harness(dirs.fleet, { exec: running({}) });
      await sup.adopt();
      expect(sup.get('R-old')?.state).toBe('detached');
      await sup.reap();
      await settled(sup, 'R-old', 'failed');
      expect(sup.get('R-old')?.pid).toBeNull();
      expect((await storedRecord(dirs.fleet, 'R-old')).info.state).toBe('failed');
    });

    it('a reused pid (a process started after the run last showed life) is not the worker', async () => {
      await seedDetached(49864);
      const { sup } = harness(dirs.fleet, { exec: running({ 49864: '2026-10-18T18:15:00Z' }) });
      await sup.adopt();
      await sup.reap();
      await settled(sup, 'R-old', 'failed');
    });

    it('a worker still alive keeps its run detached: it may yet be working', async () => {
      await seedDetached(4242);
      const { sup } = harness(dirs.fleet, { exec: running({ 4242: '2026-10-17T11:00:00Z' }) });
      await sup.adopt();
      await sup.reap();
      expect(sup.get('R-old')?.state).toBe('detached');
    });
  });
});
