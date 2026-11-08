import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { composeRunSupervisor, type RunSupervisorDeps } from '../compose-supervisor';
import type { RunDkTarget, RunInfo, RunRequest } from '../protocol';
import type { AttachInfo, NormalizedEvent, ProviderAdapter, ProviderStart, WorkerHandle } from '../harness/contract';
import { FakeTimers } from '../run-lease-timers.fake';
import type { StoredRun } from '../run/run-record';
import { FakeTicketStore } from '../store/ticket-store.fake';
import type { LiveRun } from './live-run';
import { drainSupervisors, markSettled, trackSupervisor, waitFor } from './run-spec-support';
import type { RunSupervisor, RunSupervisorParts } from './run-supervisor';

/**
 * The run supervisor's spec harness (ADR-0096, req-176): a scripted adapter,
 * the one fake ticket store, a recorded gate shell and no worktree. Every
 * request names the fake store (`dk`), the one backend: the ticket is
 * written through the claim (release, `put` inside it, comments), never as
 * a file, and the runner's own lines land in the run's stream.
 */

/** A scripted worker: exit it, feed it events, end its turn. */
export interface FakeHandle extends WorkerHandle {
  fail(code: number | null): void;
  onEvent(text: string): void;
  emit(event: Omit<NormalizedEvent, 'ts'> & { ts?: string }): void;
  result(blocked?: string | null): void;
}

export interface FakeAdapter {
  readonly adapter: ProviderAdapter;
  readonly handles: FakeHandle[];
  readonly attachInfos: AttachInfo[];
  readonly starts: ProviderStart[];
}

const TS = '2026-10-17T12:00:00Z';

export function fakeAdapter(id: ProviderAdapter['id'] = 'opencode'): FakeAdapter {
  const handles: FakeHandle[] = [];
  const attachInfos: AttachInfo[] = [];
  const starts: ProviderStart[] = [];
  const make = (start: ProviderStart): FakeHandle => {
    starts.push(start);
    let exitResolve: ((code: number | null) => void) | null = null;
    const handle: FakeHandle = {
      pid: 4242,
      exited: new Promise<number | null>((resolve) => {
        exitResolve = resolve;
      }),
      steer: vi.fn(async () => 'inject' as const),
      setHold: vi.fn(),
      interrupt: vi.fn(async () => true),
      answerPermission: vi.fn(async () => true),
      answerQuestion: vi.fn(async () => true),
      stop: vi.fn(async () => {
        exitResolve?.(null);
      }),
      fail: (code) => exitResolve?.(code),
      onEvent: (text) => start.onEvent({ ts: TS, kind: 'note', text }),
      emit: (event) => start.onEvent({ ts: TS, ...event }),
      result: (blocked) => start.onEvent({ ts: TS, kind: 'result', text: 'done', ...(blocked !== undefined ? { blocked } : {}) }),
    };
    handles.push(handle);
    return handle;
  };
  const adapter: ProviderAdapter = {
    id,
    label: id,
    liveInject: true,
    spawn: (start) => make(start),
    attach: (start, info) => {
      attachInfos.push(info);
      return make(start);
    },
  };
  return { adapter, handles, attachInfos, starts };
}

/** The fake store's target; its stages are the phases the requests below move through. */
export const DK_TARGET: RunDkTarget = { bin: 'dk', store: 'E:/store', dataDir: '', checkout: '', parkStage: null, retreatStage: 'prioritized', trailers: false };

/** A store that holds T-0001 in `plan` (the claim stage) and takes releases into the pipeline's stages. */
export function planStore(): FakeTicketStore {
  const store = new FakeTicketStore();
  store.stages = ['inbox', 'prioritized', 'plan', 'build', 'review', 'commit', 'done'];
  store.stage = 'plan';
  store.claimStage = 'plan';
  return store;
}

export function runRequest(vaultDir: string, overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    origin: 'spec',
    ticketId: 'T-0001',
    ticketsVaultPath: vaultDir,
    ticketRelPath: 'tickets/plan/T-0001.md',
    phase: 'plan',
    repoPath: 'W:/kt',
    worktreePath: 'W:/fleet-worktrees/T-0001',
    branch: 't/T-0001',
    baseRef: null,
    provider: 'opencode',
    model: null,
    permissionMode: 'accept-edits',
    instruction: 'Do the ticket.',
    acceptance: ['npm run verify:unit'],
    gate: 'commands',
    git: 'git',
    nextPhase: 'build',
    nextPhaseDir: 'build',
    pushRemote: null,
    claimIdentity: null,
    dk: DK_TARGET,
    ...overrides,
  };
}

export interface Harness {
  readonly sup: RunSupervisor;
  readonly adapter: FakeAdapter;
  readonly store: FakeTicketStore;
  readonly timers: FakeTimers;
  /** The gate commands run, in order. */
  readonly gate: string[][];
  readonly logs: string[];
}

/** A supervisor over the fake adapter and store; `deps` overrides any seam. */
export function harness(fleetRoot: string, deps: Partial<RunSupervisorDeps> = {}, store: FakeTicketStore = planStore()): Harness {
  const adapter = fakeAdapter(deps.adapter?.id);
  const gate: string[][] = [];
  const logs: string[] = [];
  const timers = new FakeTimers();
  const sup: RunSupervisor = composeRunSupervisor({
    root: fleetRoot,
    adapter: adapter.adapter,
    git: 'git',
    log: (m) => logs.push(m),
    now: () => new Date(TS),
    storeFor: () => store,
    leaseTimers: timers,
    prepareWorktree: async () => ({ outcome: 'created', sessionInvalidated: false, movedTo: null }),
    execShell: async (command) => {
      gate.push([command]);
    },
    ...deps,
    onRunSettled: (info) => {
      markSettled(sup, info.id);
      deps.onRunSettled?.(info);
    },
  });
  trackSupervisor(sup);
  return { sup, adapter, store, timers, gate, logs };
}

/** Every event of the run's stream, in order. */
export async function streamEvents(fleetRoot: string, runId: string): Promise<NormalizedEvent[]> {
  const text = await fsp.readFile(path.join(fleetRoot, 'runs', runId, 'stream.jsonl'), 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as NormalizedEvent);
}

/** The runner's own lines (`detail: 'runner'`) — what the ticket Log carried before req-176. */
export async function runnerNotes(fleetRoot: string, runId: string): Promise<string[]> {
  return (await streamEvents(fleetRoot, runId)).filter((e) => e.kind === 'note' && e.detail === 'runner').map((e) => e.text ?? '');
}

/**
 * The E14-5 fixture of the store-side specs: T-0001 waits in `prioritized`
 * (the fake store's defaults), the run works `build` — the claim stage — and
 * moves on to `commit`.
 */
export function buildRequest(vaultDir: string, overrides: Partial<RunRequest> = {}): RunRequest {
  return runRequest(vaultDir, { ticketRelPath: 'tickets/build/T-0001.md', phase: 'build', nextPhase: 'commit', nextPhaseDir: 'commit', ...overrides });
}

/** The stream file as text (every line, runner notes and worker events alike). */
export async function streamText(fleetRoot: string, runId: string): Promise<string> {
  return fsp.readFile(path.join(fleetRoot, 'runs', runId, 'stream.jsonl'), 'utf8').catch(() => '');
}

/** A harness whose fake adapter is patched (another provider id, no attach, promptless). */
export function harnessWith(fleetRoot: string, patch: Partial<ProviderAdapter>, deps: Partial<RunSupervisorDeps> = {}, store: FakeTicketStore = planStore()): Harness {
  const fake = fakeAdapter(patch.id);
  const adapter: ProviderAdapter = { ...fake.adapter, ...patch };
  const built = harness(fleetRoot, { ...deps, adapter }, store);
  return { ...built, adapter: { ...fake, adapter } };
}

/** A harness that records the order of the claim, the worktree preparation and the spawn. */
export function orderedHarness(fleetRoot: string, store: FakeTicketStore = planStore()): Harness & { readonly order: string[] } {
  const order: string[] = [];
  const claim = store.claim.bind(store);
  store.claim = (id, options) => {
    order.push('claim');
    return claim(id, options);
  };
  const prepareWorktree = async (): Promise<{ outcome: 'created'; sessionInvalidated: false; movedTo: null }> => {
    order.push('worktree');
    return { outcome: 'created', sessionInvalidated: false, movedTo: null };
  };
  const built = harness(fleetRoot, { prepareWorktree }, store);
  const adapter = built.adapter.adapter as { spawn: ProviderAdapter['spawn'] };
  const spawn = adapter.spawn;
  adapter.spawn = (start) => {
    order.push('spawn');
    return spawn(start);
  };
  return { ...built, order };
}

/** The run as the supervisor holds it — for a spec that sets a counter the worker would have reported. */
export function liveRun(sup: RunSupervisor, runId: string): LiveRun {
  const run = (sup as unknown as { readonly parts: RunSupervisorParts }).parts.repo.find(runId);
  if (run === undefined) {
    throw new Error(`no run ${runId}`);
  }
  return run;
}

/** Starts a run and answers its id; a refused start fails the spec. */
export async function startRun(sup: RunSupervisor, request: RunRequest, persona?: string): Promise<string> {
  const outcome = await sup.start(request, persona === undefined ? {} : { persona });
  if (!outcome.ok) {
    throw new Error(outcome.error);
  }
  return outcome.run.id;
}

/**
 * The worker reports its spend, and the spec waits until the fold landed
 * on the record: the exit of a run that does not stop for its event queue
 * (a dialog, a gate) would otherwise race the fold.
 */
export async function reportUsage(h: Harness, runId: string, worker: number, usage: { tokensIn: number; tokensOut: number; costUsd?: number }): Promise<void> {
  h.adapter.starts[worker]!.onEvent({ ts: '2026-10-17T12:00:10Z', kind: 'usage', ...usage });
  await waitFor(() => expect(h.sup.get(runId)?.tokensIn).toBe(usage.tokensIn));
}

/** The worker finishes its turn (optionally blocked) and exits 0. */
export function endTurn(handle: FakeHandle, blocked?: string | null): void {
  handle.result(blocked);
  handle.fail(0);
}

/** A complete record for a seeded `run.json`: the defaults of a live T-0001 run of OpenCode. */
export function runInfo(over: Partial<RunInfo> & { readonly id: string }): RunInfo {
  const startedAt = over.startedAt ?? '2026-10-17T11:00:00Z';
  return {
    ticketId: 'T-0001',
    provider: 'opencode',
    state: 'running',
    pid: null,
    startedAt,
    endedAt: null,
    sessionRef: null,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: null,
    lastActivity: startedAt,
    steerCount: 0,
    lastSteerRung: null,
    worktreePath: 'x',
    branch: 't/T-0001',
    gateFailure: null,
    ...over,
  };
}

/** Seeds `runs/<id>/run.json` (and `attach.json` when given) as an earlier runner left it. */
export async function writeRecord(fleetRoot: string, stored: StoredRun, attach?: object): Promise<string> {
  const dir = path.join(fleetRoot, 'runs', stored.info.id);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'run.json'), JSON.stringify(stored), 'utf8');
  if (attach !== undefined) {
    await fsp.writeFile(path.join(dir, 'attach.json'), JSON.stringify(attach), 'utf8');
  }
  return dir;
}

/** The record on disk. */
export async function storedRecord(fleetRoot: string, runId: string): Promise<StoredRun> {
  return JSON.parse(await fsp.readFile(path.join(fleetRoot, 'runs', runId, 'run.json'), 'utf8')) as StoredRun;
}

/** Every process probe answers "alive" (the pid echoed back as tasklist would). */
export const aliveProbe = async (_cmd: string, args: readonly string[]): Promise<string> => `"${/\d+/.exec(args.join(' '))?.[0] ?? ''}"`;

/** A temp vault (the worker's ticket copy, the persona memory) and a temp fleet root per test, drained before removal. */
export interface TempDirs {
  vault: string;
  fleet: string;
}

export function useTempDirs(): TempDirs {
  const dirs: TempDirs = { vault: '', fleet: '' };
  beforeEach(async () => {
    dirs.vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-vault-'));
    dirs.fleet = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-fleet-'));
  });
  afterEach(async () => {
    await drainSupervisors();
    await fsp.rm(dirs.vault, { recursive: true, force: true });
    await fsp.rm(dirs.fleet, { recursive: true, force: true });
  });
  return dirs;
}
