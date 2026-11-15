import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunInfo } from '../protocol';
import { drainSupervisors, settled } from './run-spec-support';
import { harness, runRequest, streamEvents } from './supervisor-harness.fake';

/**
 * The start's worktree wiring (T-0047): the preparation's outcome reaches
 * the record and the run's opening lines, and a failed preparation is a
 * refused start that spawns nothing. Moved from `worktrees.spec.ts` with
 * the run supervisor's split (req-176); the requests name the store now.
 */

let vaultDir = '';
let fleetRoot = '';

beforeEach(async () => {
  vaultDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-vault-'));
  fleetRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-fleet-'));
});

afterEach(async () => {
  await drainSupervisors();
  await fsp.rm(vaultDir, { recursive: true, force: true });
  await fsp.rm(fleetRoot, { recursive: true, force: true });
});

const streamText = async (runId: string): Promise<string> => (await streamEvents(fleetRoot, runId)).map((e) => e.text ?? '').join('\n');

describe('RunStarter worktree wiring', () => {
  it('threads a stateful outcome into the second run and its stream', async () => {
    const outcomes = ['created', 'reused'] as const;
    let calls = 0;
    const { sup, adapter } = harness(fleetRoot, {
      prepareWorktree: async () => ({ outcome: outcomes[Math.min(calls++, 1)]!, sessionInvalidated: false, movedTo: null }),
    });
    const request = (over: Parameters<typeof runRequest>[1] = {}) => runRequest(vaultDir, { worktreePath: path.join(fleetRoot, 'worktrees', 'kt-T-0001'), ...over });
    const first = await sup.start(request());
    expect(first.ok).toBe(true);
    expect((first as { run: RunInfo }).run.worktree).toBe('created');
    const firstId = (first as { run: RunInfo }).run.id;
    adapter.handles[0]!.result();
    adapter.handles[0]!.fail(0);
    await settled(sup, firstId, 'done');

    // Next phase, same ticket: the worktree already exists.
    const second = await sup.start(request({ ticketRelPath: 'tickets/build/T-0001.md', phase: 'build' }));
    expect(second.ok).toBe(true);
    const info = (second as { run: RunInfo }).run;
    expect(info.worktree).toBe('reused');
    expect(await streamText(info.id)).toContain('— worktree reused');
  });

  it('reports a moved-aside worktree in the stream with its parking path', async () => {
    const { sup } = harness(fleetRoot, {
      prepareWorktree: async () => ({ outcome: 'moved-aside' as const, sessionInvalidated: true, movedTo: 'W:/fleet/worktrees/kt-T-0001.stale-20261019T010203' }),
    });
    const started = await sup.start(runRequest(vaultDir));
    expect(started.ok).toBe(true);
    const info = (started as { run: RunInfo }).run;
    expect(info.worktree).toBe('moved-aside');
    const stream = await streamText(info.id);
    expect(stream).toContain('— worktree moved-aside');
    expect(stream).toContain('stale dirty worktree moved aside to W:/fleet/worktrees/kt-T-0001.stale-20261019T010203 — kept, not deleted; earlier session context is invalid');
  });

  it('wraps a rejecting preparation as a failed start: nothing spawns, the claim goes back', async () => {
    const { sup, adapter, store } = harness(fleetRoot, {
      prepareWorktree: async () => {
        throw new Error('worktree W:/x is locked');
      },
    });
    const started = await sup.start(runRequest(vaultDir));
    expect(started.ok).toBe(false);
    expect((started as { error: string }).error).toContain('worktree failed:');
    expect((started as { error: string }).error).toContain('is locked');
    expect(sup.list()).toHaveLength(0);
    expect(adapter.handles).toHaveLength(0);
    expect(store.of('release').map((c) => c.stage)).toEqual(['plan', 'active']); // back where it sat (refused in the claim stage), else active
  });
});
