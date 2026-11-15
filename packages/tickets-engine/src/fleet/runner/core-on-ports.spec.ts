import { describe, expect, it } from 'vitest';
import type { RunInfo, RunRequest } from '../protocol';
import { NULL_SINK } from '../ports/event-sink';
import { MemoryFileSystem } from '../ports/memory-file-system.fake';
import { ChainState } from '../chain/chain-state';
import { ChainStateStore } from '../chain/chain-state-store';
import { newLiveRun } from './live-run';
import { RunRepository } from './run-repository';
import { RunStreams } from './run-streams';

/**
 * The core on its ports (ADR-0096, req-176 step 4): the record, the
 * stream and the chain's state run on an in-memory file system and a fixed
 * clock — no disk, no wait.
 */

const clock = { now: () => new Date('2026-11-08T12:00:00Z') };
const info = { id: 'R-1', ticketId: 'T-0001', provider: 'opencode', state: 'running', pid: null, startedAt: '2026-11-08T11:00:00Z', endedAt: null, sessionRef: null, tokensIn: 0, tokensOut: 0, costUsd: null, lastActivity: '2026-11-08T11:00:00Z', steerCount: 0, lastSteerRung: null, worktreePath: 'W:/wt', branch: 't/T-0001', gateFailure: null } as RunInfo;
const request = { ticketId: 'T-0001', phase: 'build' } as RunRequest;

describe('the run record and stream on the FileSystem port', () => {
  it('persists the record, appends the stream and finds the run again', async () => {
    const fs = new MemoryFileSystem();
    const repo = new RunRepository('/fleet', fs, NULL_SINK);
    const streams = new RunStreams(clock, fs, NULL_SINK);
    const run = newLiveRun({ info, request, dir: repo.dirFor('R-1') });
    repo.add(run);
    await repo.persist(run);
    await streams.open(run, [{ ts: 'x', kind: 'note', text: 'opened' }]);
    await streams.say(run, 'gate: npm test', 'runner');
    expect(await fs.readText('/fleet/runs/R-1/stream.jsonl')).toContain('"detail":"runner","text":"gate: npm test"');
    const found = await new RunRepository('/fleet', fs, NULL_SINK).found();
    expect(found.map((f) => [f.dir, f.stored.info.id])).toEqual([['/fleet/runs/R-1', 'R-1']]);
  });

  it('keeps the take-back credential in a file of its own and drops it with the run', async () => {
    const fs = new MemoryFileSystem();
    const repo = new RunRepository('/fleet', fs, NULL_SINK);
    const run = newLiveRun({ info, request, dir: repo.dirFor('R-1') });
    await repo.writeAttach(run, { address: 'http://127.0.0.1:1', password: 'p', pid: 7, pidStartedMs: 1 });
    expect(await repo.hasAttach(run)).toBe(true);
    expect((await repo.readAttach(run.dir))?.pid).toBe(7);
    await repo.removeAttach(run);
    expect(await repo.hasAttach(run)).toBe(false);
  });
});

describe("the chain's state on the FileSystem port", () => {
  it('writes chain.json atomically and boots the Autopilot Off from it (the boot rule)', async () => {
    const fs = new MemoryFileSystem();
    const logs: string[] = [];
    const store = new ChainStateStore('/fleet', fs, clock, (m) => logs.push(m));
    const state = new ChainState();
    state.vault = { ticketsVaultPath: 'T:/tickets', git: 'git' };
    state.autopilot = { state: 'on' };
    state.columns['build'] = 'held';
    await store.persist(state);
    expect(fs.atomicWrites).toEqual([store.fileFor('T:/tickets'), '/fleet/chain-vault.json']);
    const restored = new ChainState();
    expect(await store.load(restored)).toBe(true);
    expect(restored.autopilot.state).toBe('off');
    expect(restored.columns).toEqual({ build: 'held' });
    expect(logs.some((l) => l.includes('it is off now (boot rule)'))).toBe(true);
  });
});
