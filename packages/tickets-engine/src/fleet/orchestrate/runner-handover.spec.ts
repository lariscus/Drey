import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunRequest } from '../protocol';
import { HANDOVER_CONTINUE } from './run-adoption';
import type { RunSupervisorDeps } from '../compose-supervisor';
import type { FakeTicketStore } from '../store/ticket-store.fake';
import { settled, waitFor } from './run-spec-support';
import type { RunSupervisor } from './run-supervisor';
import { endTurn, harness, harnessWith, planStore, runRequest, startRun, storedRecord, useTempDirs, type FakeAdapter, type Harness } from './supervisor-harness.fake';

/**
 * The runner handover (req-51): a runner retired for a newer build leaves
 * its live runs to the successor instead of stopping them. The probe exec
 * answers nothing, so no real process is ever probed or killed here.
 */
describe('RunnerHandover — a retiring runner leaves its runs to the successor', () => {
  const dirs = useTempDirs();
  const request = (over: Partial<RunRequest> = {}): RunRequest => runRequest(dirs.vault, over);
  const noProbe = async (): Promise<string> => '';

  /** A Claude-Code-like fake: same scripted handles, no attach. */
  const claudeHarness = (deps: Partial<RunSupervisorDeps> = {}, store?: FakeTicketStore): Harness =>
    harnessWith(dirs.fleet, { id: 'claude-code', attach: undefined }, { exec: noProbe, ...deps }, store);

  async function startedClaudeRun(sup: RunSupervisor, adapter: FakeAdapter): Promise<string> {
    const id = await startRun(sup, request({ provider: 'claude-code' }));
    adapter.starts[0]!.onSessionRef('ses_claude');
    // the session ref is persisted fire-and-forget: wait for that write to land
    await waitFor(async () => expect(await fsp.readFile(path.join(dirs.fleet, 'runs', id, 'run.json'), 'utf8').catch(() => '')).toContain('ses_claude'));
    return id;
  }

  it('stops a worker it cannot leave running, keeps the run live on disk and the claim held', async () => {
    const { sup, adapter, store } = claudeHarness();
    const id = await startedClaudeRun(sup, adapter);

    expect(sup.handoverBlocker()).toBeNull();
    expect(await sup.handOver()).toBe(1);

    expect(adapter.handles[0]!.stop).toHaveBeenCalled();
    // the worker's exit decides nothing in the retiring runner
    await sup.idle();
    expect(sup.get(id)?.state).toBe('running');
    const stored = await storedRecord(dirs.fleet, id);
    expect(stored.info.state).toBe('running');
    expect(stored.handover?.mode).toBe('resume');
    // req-176: the ticket stays the run's — no release (it was the kept file stamp).
    expect(store.of('release')).toHaveLength(0);

    // nothing new starts, and a stop would be undone by the successor's resume
    expect((await sup.start(request())).ok).toBe(false);
    expect((await sup.stop(id, null)).ok).toBe(false);
  });

  it('leaves a worker with an attach file running for the successor to re-attach', async () => {
    const { sup, adapter } = harness(dirs.fleet, { exec: noProbe });
    const id = await startRun(sup, request());
    await fsp.writeFile(path.join(dirs.fleet, 'runs', id, 'attach.json'), '{}', 'utf8');

    await sup.handOver();
    expect(adapter.handles[0]!.stop).not.toHaveBeenCalled();
    expect((await storedRecord(dirs.fleet, id)).handover?.mode).toBe('reattach');
  });

  it('records the server listening on the address as the attach pid, not the shell around it', async () => {
    const exec = async (cmd: string, args: readonly string[]): Promise<string> => {
      const line = [cmd, ...args].join(' ');
      if (line.includes('Get-NetTCPConnection')) {
        return '777';
      }
      return line.includes('StartTime') ? '1700000000000' : '';
    };
    const { sup, adapter } = harness(dirs.fleet, { exec });
    const id = await startRun(sup, request());
    adapter.starts[0]!.onAttachInfo?.({ address: 'http://127.0.0.1:50918', password: 'pw', pid: 4242 });
    const attachPath = path.join(dirs.fleet, 'runs', id, 'attach.json');
    await waitFor(async () => expect(await fsp.readFile(attachPath, 'utf8').catch(() => '')).toContain('pidStartedMs'));
    const attach = JSON.parse(await fsp.readFile(attachPath, 'utf8')) as { pid: number; pidStartedMs: number };
    expect(attach.pid).toBe(process.platform === 'win32' ? 777 : 4242);
    expect(attach.pidStartedMs).toBe(1700000000000);
  });

  it('a resume in place ends the server the attach file records before the fresh worker starts', async () => {
    const probed: string[] = [];
    const exec = async (cmd: string, args: readonly string[]): Promise<string> => {
      probed.push([cmd, ...args].join(' '));
      return '';
    };
    const first = claudeHarness();
    const id = await startedClaudeRun(first.sup, first.adapter);
    await first.sup.handOver();
    // a server pid nothing runs under: the guarded kill only probes it
    const attach = { address: 'http://127.0.0.1:50919', password: 'pw', pid: 2_147_483_000, pidStartedMs: 1700000000000 };
    await fsp.writeFile(path.join(dirs.fleet, 'runs', id, 'attach.json'), JSON.stringify(attach), 'utf8');

    const second = claudeHarness({ exec });
    await second.sup.adopt();
    expect(second.sup.get(id)?.state).toBe('running');
    expect(probed.some((line) => line.includes('2147483000'))).toBe(true);
  });

  it('defers while a run is in its machine gate', async () => {
    // The gate's promise exists before the run does: the blocker turns true
    // when the run enters the gate state, which can be before `execShell` is
    // called — a release wired inside `execShell` then fired into the void.
    let releaseGate: () => void = () => undefined;
    const gateReleased = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const { sup, adapter } = harness(dirs.fleet, { exec: noProbe, execShell: () => gateReleased });
    const id = await startRun(sup, request());
    endTurn(adapter.handles[0]!);
    await waitFor(() => expect(sup.handoverBlocker()).toContain('machine gate'));
    releaseGate();
    await settled(sup, id, 'done');
    expect(sup.handoverBlocker()).toBeNull();
  });

  it('the successor resumes a handed-over session in place — same run id, a fresh worker', async () => {
    const store = planStore();
    const first = claudeHarness({}, store);
    const id = await startedClaudeRun(first.sup, first.adapter);
    await first.sup.handOver();

    const second = claudeHarness({}, store);
    await second.sup.adopt();

    const run = second.sup.get(id);
    expect(run?.state).toBe('running');
    expect(run?.pid).toBe(4242);
    expect(second.adapter.starts).toHaveLength(1);
    expect(second.adapter.starts[0]!.resumeRef).toBe('ses_claude');
    expect(second.adapter.starts[0]!.instruction).toBe(HANDOVER_CONTINUE);
    // the record is an ordinary live run again
    expect((await storedRecord(dirs.fleet, id)).handover).toBeUndefined();
    // req-176: the runner log says so (it was a ticket Log line).
    expect(second.logs).toContain(`run ${id}: resumed in place after a runner handover`);

    // and it ends like any run: agent done, gate green, the ticket is released
    endTurn(second.adapter.handles[0]!);
    await settled(second.sup, id, 'done');
    expect(store.of('release').map((c) => c.stage)).toEqual(['plan', 'active']); // no cursor: the green end releases the ticket where it sat (req-307)
  });

  it("keeps a resumed session's usage base across the handover, so the run's counts go on from its own (req-53)", async () => {
    const first = claudeHarness();
    const id = await startedClaudeRun(first.sup, first.adapter);
    const base = { tokensIn: 10_000, tokensOut: 50, cacheReadTokens: 9_000, costUsd: null };
    first.adapter.starts[0]!.onUsageBase!(base);
    await waitFor(async () => expect(await fsp.readFile(path.join(dirs.fleet, 'runs', id, 'run.json'), 'utf8')).toContain('usageBase'));
    await first.sup.handOver();

    const second = claudeHarness();
    await second.sup.adopt();
    expect(second.adapter.starts[0]!.usageBase).toEqual(base);
  });

  it('a run without a recorded base resumes from zero — its own session is counted whole', async () => {
    const first = claudeHarness();
    const id = await startedClaudeRun(first.sup, first.adapter);
    await first.sup.handOver();
    const second = claudeHarness();
    await second.sup.adopt();
    expect(second.sup.get(id)?.state).toBe('running');
    expect(second.adapter.starts[0]!.usageBase).toEqual({ tokensIn: 0, tokensOut: 0, cacheReadTokens: 0, costUsd: null });
  });

  it('a held run comes back held and fully silent — no resume prompt at all', async () => {
    const first = claudeHarness();
    const id = await startedClaudeRun(first.sup, first.adapter);
    expect((await first.sup.takeover(id)).ok).toBe(true);
    await first.sup.handOver();

    const second = claudeHarness();
    await second.sup.adopt();
    expect(second.sup.get(id)?.held).toBe(true);
    // The resume prompt itself caused the "I'm back" no-op turns
    // (R-20261030T20203-wpsd): a held resume delivers nothing — the
    // worker stands, held, until the owner sends.
    expect(second.adapter.starts[0]!.instruction).toBe(HANDOVER_CONTINUE);
    expect(second.adapter.starts[0]!.holdAtSpawn).toBe(true);
    expect(second.adapter.handles[0]!.setHold).toHaveBeenCalledWith(true);
  });

  it('a held worker that stood idle is resumed fully silent, like any held run (req-80 idle case via req-75 holdAtSpawn)', async () => {
    const promptless = (): Harness => harnessWith(dirs.fleet, { id: 'claude-code', attach: undefined }, { exec: noProbe });
    const first = promptless();
    const id = await startedClaudeRun(first.sup, first.adapter);
    expect((await first.sup.takeover(id)).ok).toBe(true);
    first.adapter.starts[0]!.onEvent({ ts: '2026-10-17T12:00:00Z', kind: 'usage', turn: 'idle' });
    await waitFor(() => expect(first.sup.get(id)?.turn).toBe('idle'));
    await first.sup.handOver();

    const second = promptless();
    await second.sup.adopt();
    expect(second.sup.get(id)?.held).toBe(true);
    // req-75 subsumes req-80's empty-prompt case: nothing is delivered at
    // all, not even an empty instruction.
    expect(second.adapter.starts[0]!.instruction).toBe(HANDOVER_CONTINUE);
    expect(second.adapter.starts[0]!.holdAtSpawn).toBe(true);

    // a busy one goes silent the same way — HANDOVER_HELD is gone (req-75)
    const third = promptless();
    const busy = await startedClaudeRun(third.sup, third.adapter);
    expect((await third.sup.takeover(busy)).ok).toBe(true);
    third.adapter.starts[0]!.onEvent({ ts: '2026-10-17T12:00:00Z', kind: 'usage', turn: 'busy' });
    await waitFor(() => expect(third.sup.get(busy)?.turn).toBe('busy'));
    await third.sup.handOver();
    const fourth = promptless();
    await fourth.sup.adopt();
    expect(fourth.adapter.starts.map((s) => s.instruction)).toContain(HANDOVER_CONTINUE);
    expect(fourth.adapter.starts.every((s) => s.holdAtSpawn === true)).toBe(true);
  });

  it('a handed-over run without a session detaches as before', async () => {
    const first = claudeHarness();
    const id = await startRun(first.sup, request({ provider: 'claude-code' }));
    await first.sup.handOver();

    const second = claudeHarness();
    await second.sup.adopt();
    expect(second.sup.get(id)?.state).toBe('detached');
    expect(second.adapter.starts).toHaveLength(0);
  });

  it("a supervisor adopts only its own provider's runs", async () => {
    const first = claudeHarness();
    const id = await startedClaudeRun(first.sup, first.adapter);
    const before = await fsp.readFile(path.join(dirs.fleet, 'runs', id, 'run.json'), 'utf8');

    const opencode = harness(dirs.fleet, { exec: noProbe });
    await opencode.sup.adopt();
    expect(opencode.sup.get(id)).toBeNull();
    expect(await fsp.readFile(path.join(dirs.fleet, 'runs', id, 'run.json'), 'utf8')).toBe(before);
  });
});
