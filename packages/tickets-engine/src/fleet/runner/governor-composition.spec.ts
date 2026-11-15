import { describe, expect, it } from 'vitest';
import { composeGovernor, governorSeats } from './compose-governor';
import { FakeGovernorProcesses, ManualClock } from '../governor/governor-rig.fake';
import type { GovernorTimers } from '../governor/governor-timers';
import { settled, waitFor } from '../runner/run-spec-support';
import { endTurn, harness, runnerNotes, runRequest, startRun, useTempDirs } from '../runner/supervisor-harness.fake';
import type { GateShellOptions } from '../runner/gate-runner';
import type { RunnerEvent } from '../ports/event-sink';
import { FakeProcessPriority } from '../ports/process-priority.fake';
import { FakeSystemLoad } from '../ports/system-load.fake';
import { DEFAULT_GOVERNOR_SETTINGS, type GovernorSettings } from '../protocol-governor';

const NO_TIMERS: GovernorTimers = { every: () => () => undefined };

/** The real governor composition over fake machine ports; the log lines and events recorded. */
function governorRig(settings: GovernorSettings) {
  const lines: string[] = [];
  const events: RunnerEvent[] = [];
  const priority = new FakeProcessPriority();
  const { governor } = composeGovernor(
    { settings: () => settings, log: (line) => lines.push(line), lightTotal: () => 4 },
    { load: new FakeSystemLoad(), priority, processes: new FakeGovernorProcesses(), clock: new ManualClock(), sink: { publish: (e) => events.push(e) }, timers: NO_TIMERS },
  );
  return { governor, lines, events, priority };
}

describe('the resource governor through the real composition (req-180)', () => {
  const dirs = useTempDirs();

  it('a gate command waits for a heavy seat, runs when it frees, at low priority with the parallelism variables', async () => {
    const rig = governorRig({ ...DEFAULT_GOVERNOR_SETTINGS, heavySeats: 1 });
    const shells: { command: string; opts: GateShellOptions | undefined }[] = [];
    const { sup, adapter } = harness(dirs.fleet, {
      seats: governorSeats(rig.governor),
      // runner.ts hands the settle to the governor beside the chain.
      onRunSettled: (info) => rig.governor.runSettled(info.id),
      execShell: async (command, _cwd, opts) => {
        shells.push({ command, opts });
        opts?.onSpawn?.(5150);
      },
    });
    // Another run's build holds the only heavy seat.
    const blocker = await rig.governor.heavy({ runId: 'R-other', ticket: 'T-0126', task: 'build', worktree: '/wt/other' });

    const id = await startRun(sup, runRequest(dirs.vault));
    expect(adapter.starts[0]?.env).toMatchObject({ DREY_DEV_PORT: '4300' });
    expect(sup.get(id)?.devPort).toBe(4300);
    expect(rig.governor.status().light.busy).toBe(1);

    endTurn(adapter.handles[0]!);
    await waitFor(() => expect(sup.get(id)?.activity).toBe('waits for a heavy seat · 1 of 1 heavy seats busy'));
    expect(shells).toEqual([]);
    expect(rig.lines).toContain('governor: T-0001 tests waits · 1 of 1 heavy seats busy');
    expect(rig.governor.status().waiting).toMatchObject([{ ticket: 'T-0001', task: 'tests', reason: '1 of 1 heavy seats busy' }]);
    expect(await runnerNotes(dirs.fleet, id)).toContain('gate: `npm run verify:unit` waits — 1 of 1 heavy seats busy');

    blocker.release();
    await settled(sup, id, 'done');
    expect(shells.map((s) => s.command)).toEqual(['npm run verify:unit']);
    expect(shells[0]?.opts?.env).toMatchObject({ VITEST_MAX_WORKERS: '6', MAKEFLAGS: '-j6' });
    expect(rig.priority.lowered).toEqual([5150]);
    expect(rig.lines).toContain('governor: heavy seat granted to T-0001 tests · 1 of 1');
    expect(rig.lines).toContain('governor: heavy seat released by T-0001 tests · 0 of 1');
    // The settle gave the worktree's port back; the worker's exit its light seat.
    await waitFor(() => expect(rig.governor.status()).toMatchObject({ devServers: [], light: { busy: 0 }, heavy: { busy: 0 } }));
    expect(rig.events.some((e) => e.kind === 'governor')).toBe(true);
  });

  it('a run stopped while its gate waits gives up the wait', async () => {
    const rig = governorRig({ ...DEFAULT_GOVERNOR_SETTINGS, heavySeats: 1 });
    const { sup, adapter } = harness(dirs.fleet, { seats: governorSeats(rig.governor) });
    await rig.governor.heavy({ runId: 'R-other', ticket: 'T-0126', task: 'build', worktree: '/wt/other' });
    const id = await startRun(sup, runRequest(dirs.vault));
    endTurn(adapter.handles[0]!);
    await waitFor(() => expect(rig.governor.status().waiting).toHaveLength(1));
    const run = sup.get(id);
    expect(run?.state).toBe('running');
    await sup.stop(id, null).catch(() => undefined);
    rig.governor.tick();
    await waitFor(() => expect(rig.governor.status().waiting).toEqual([]));
    expect(rig.lines, rig.lines.join(' | ')).toContain('governor: T-0001 tests no longer waits · the run stopped');
  });
});
