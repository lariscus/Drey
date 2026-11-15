import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { vi, type Mock } from 'vitest';
import { composeOrchestrator, type OrchestratorDeps } from '../compose-orchestrator';
import { composeShared } from '../compose-supervisor';
import type { Orchestrator } from '../orchestrator';
import { normalizeFleetPools, type ChainConfig, type ChainStoreConfig, type FleetPools, type RunInfo, type RunRequest } from '../protocol';
import type { StartOutcome, StopOutcome, SupervisorRecord } from '../run/run-record';
import { StoreChainBoard } from '../store-chain-board';
import { FakeChainIo, type SeedOptions } from './chain-io.fake';
import type { StartOptions } from './run-supervisor';
import type { SupervisorPort } from './supervisor-directory';
import { ChainStatePaths } from './chain-state-paths';

/**
 * The chain orchestrator's spec harness (req-176): the real
 * `composeOrchestrator` over a fake dricket store (`FakeChainIo`) and a fake
 * supervisor port; the meta vault (pipeline, repos, prompts, personas) is a
 * temp dir on disk as in production. One harness per test: `setUp` before,
 * `tearDown` after (it disposes every orchestrator it built first).
 */

/** The persona board's pipeline (req-307): the lifecycle columns and the flow; who runs a ticket is its chain. */
export const PIPELINE = [
  '---',
  'phases:',
  '  - { id: inbox, title: Inbox, handover: manual }',
  '  - { id: prioritized, title: Prioritized, handover: manual }',
  '  - { id: done, title: Done, handover: none }',
  'flow: ben; you',
  '---',
  'Prose.',
  '',
].join('\n');

export const REPOS = ['---', 'repos:', '  drey:', '    url: https://example.test/drey.git', '    branch: main', '    path: W:/drey', '---', 'Prose.', ''].join('\n');

export const STORE: ChainStoreConfig = { dkPath: 'dk', dkStore: 'E:/store', dkDataDir: '', dkCheckout: 'E:/store', trailers: false };

/** Two OpenCode slots shared by every column (req-63). */
export const TWO: FleetPools = normalizeFleetPools({ opencode: { size: 2 } });
export const ONE: FleetPools = normalizeFleetPools({});

/** A run record as the fake supervisor holds it. */
function runInfo(id: string, request: Pick<RunRequest, 'ticketId' | 'provider' | 'branch'>): RunInfo {
  return {
    id,
    ticketId: request.ticketId,
    provider: request.provider,
    state: 'running',
    pid: 4242,
    startedAt: '2026-10-18T12:00:00Z',
    endedAt: null,
    sessionRef: null,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: null,
    lastActivity: '2026-10-18T12:00:00Z',
    steerCount: 0,
    lastSteerRung: null,
    worktreePath: 'W:/wt',
    branch: request.branch,
    gateFailure: null,
  };
}

export interface FakeFleet {
  readonly port: SupervisorPort;
  readonly records: SupervisorRecord[];
  readonly start: Mock<(request: RunRequest, options?: StartOptions) => Promise<StartOutcome>>;
  readonly stop: SupervisorPort['stop'];
  /** Ends a run: its record takes the patch, the settled info is returned for `onRunSettled`. */
  end(record: SupervisorRecord, patch: Partial<RunInfo>): RunInfo;
}

export function fakePort(): FakeFleet {
  const records: SupervisorRecord[] = [];
  let counter = 0;
  const start = vi.fn(async (request: RunRequest, _options?: StartOptions): Promise<StartOutcome> => {
    counter += 1;
    const info = runInfo(`R-${String(counter).padStart(3, '0')}`, request);
    records.push({ info, request });
    return { ok: true, run: info };
  });
  const stop = vi.fn(async (runId: string, _reason: string | null): Promise<StopOutcome> => {
    const index = records.findIndex((r) => r.info.id === runId);
    if (index >= 0) {
      records[index] = { ...records[index]!, info: { ...records[index]!.info, state: 'stopped' } };
    }
    return { ok: true };
  });
  const port: SupervisorPort = { start, stop, records: () => [...records], reap: vi.fn(async (): Promise<void> => undefined) };
  const end = (record: SupervisorRecord, patch: Partial<RunInfo>): RunInfo => {
    const info = { ...record.info, ...patch };
    records[records.indexOf(record)] = { ...record, info };
    return info;
  };
  return { port, records, start, stop, end };
}

/** A failed run of `ticket` at its first chain position whose gate failed with `failure` (T-0048's retry context). */
export function failedRecord(ticket: string, failure: string): SupervisorRecord {
  const info = runInfo(`R-old-${ticket}`, { ticketId: ticket, provider: 'opencode', branch: `t/${ticket}` });
  return {
    info: { ...info, state: 'failed', pid: null, startedAt: '2026-10-18T11:00:00Z', endedAt: '2026-10-18T11:20:00Z', lastActivity: '2026-10-18T11:20:00Z', gateFailure: failure, chainPosition: { at: 1, length: 2 } },
    request: { ticketId: ticket, column: 'active', cursor: { at: 1, length: 2 } } as RunRequest,
  };
}

/** What a ticket the chain runs needs beyond the store's defaults: whose entry it stands at and where. */
export interface RunSeed extends SeedOptions {
  /** The persona of the first entry (default `ben`); the chain is `<persona>; you`. */
  readonly persona?: string;
  /** The cursor (default 1). */
  readonly at?: number;
}

/** A persona file's knobs (`tickets/_meta/personas/<id>/`). */
export interface PersonaSeed {
  /** req-288: a v3 record's class (then `pin` is its pinned model). */
  readonly class?: string;
  readonly pin?: string;
  readonly worker?: string;
  readonly model?: string;
  readonly pool?: readonly string[];
  readonly role?: string;
  /** The persona's prompt.md; absent = a one-line default, `null` = no file at all. */
  readonly prompt?: string | null;
  readonly memory?: string;
  readonly skills?: readonly string[];
}

export interface Built {
  readonly orch: Orchestrator;
  readonly fleet: FakeFleet;
  readonly logs: string[];
}

export type BuildOptions = Partial<OrchestratorDeps> & { readonly fleet?: FakeFleet };

export class ChainHarness {
  vaultDir = '';
  fleetRoot = '';
  readonly io = new FakeChainIo();
  private readonly built: Orchestrator[] = [];

  /** Temp dirs plus the meta vault: the persona board's pipeline, repos, the builder Ben (prompt "Build it.") and You. */
  async setUp(pipeline = PIPELINE): Promise<void> {
    this.vaultDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-meta-'));
    this.fleetRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-fleet-'));
    await this.write('tickets/_meta/pipeline.md', pipeline);
    await this.write('tickets/_meta/repos.md', REPOS);
    await this.writePersona('ben', { prompt: 'Build it.' });
    await this.writeHuman();
  }

  /** Seeds an `active` ticket whose chain entry at the cursor is an agent persona's: the holder pass dispatches it. */
  seedRun(id: string, over: RunSeed = {}): void {
    const { persona = 'ben', at = 1, extensions, ...rest } = over;
    this.io.seed(id, 'active', { chain: [persona, 'you'], ...rest, extensions: { at: String(at), ...extensions } });
  }

  async tearDown(): Promise<void> {
    this.built.forEach((orch) => orch.dispose());
    await fsp.rm(this.vaultDir, { recursive: true, force: true });
    await fsp.rm(this.fleetRoot, { recursive: true, force: true });
  }

  /** Writes a file of the meta vault (path relative to the vault root). */
  async write(rel: string, text: string): Promise<void> {
    const file = path.join(this.vaultDir, rel);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, text, 'utf8');
  }

  async remove(rel: string): Promise<void> {
    await fsp.rm(path.join(this.vaultDir, rel));
  }

  config(over: Partial<ChainConfig> = {}): ChainConfig {
    return { ticketsVaultPath: this.vaultDir, store: STORE, git: 'git', defaultWorker: 'opencode', permissionMode: 'accept-edits', pools: TWO, ...over };
  }

  /** The vault's `chain.json` as the orchestrator last wrote it (req-173: one per vault). */
  async chainFile(): Promise<Record<string, unknown>> {
    return JSON.parse(await fsp.readFile(path.join(this.fleetRoot, 'chains', ChainStatePaths.keyOf(this.vaultDir), 'chain.json'), 'utf8')) as Record<string, unknown>;
  }

  /** The real composition over the fake store and a fake (or the given) supervisor port; logs land in `logs`. */
  build(over: BuildOptions = {}): Built {
    const { fleet = fakePort(), ...deps } = over;
    const logs: string[] = [];
    const log = deps.log ?? ((message: string) => logs.push(message));
    const storeFor = (): never => {
      throw new Error('the chain writes through its store door, never a run store');
    };
    const orch = composeOrchestrator({
      root: this.fleetRoot,
      log,
      supervisorOf: () => fleet.port,
      scanIntervalMs: 60_000,
      bookkeeper: composeShared(storeFor, log, deps.now).bookkeeper,
      storeChainFor: () => new StoreChainBoard(this.io, log),
      ...deps,
    });
    this.built.push(orch);
    return { orch, fleet, logs };
  }

  async writePersona(id: string, over: PersonaSeed = {}): Promise<void> {
    const model = over.model ?? 'opus';
    // req-288: `class` writes a v3 record (class and an optional pin); without it the v2 keys the migration reads.
    const keys = over.class !== undefined
      ? [`class: ${over.class}`, ...(over.pin !== undefined ? [`model: "${over.pin}"`] : [])]
      : [`worker: ${over.worker ?? 'opencode'}`, 'models:', `  default: ${model}`, `  pool: [${(over.pool ?? [model]).join(', ')}]`];
    const lines = ['---', `title: ${id}`, `role: ${over.role ?? 'builder'}`, ...keys, "color: '#a78bfa'", `skills: [${(over.skills ?? []).join(', ')}]`, '---', ''];
    await this.write(`tickets/_meta/personas/${id}/persona.md`, lines.join('\n'));
    if (over.prompt !== null) {
      await this.write(`tickets/_meta/personas/${id}/prompt.md`, over.prompt ?? `Work as ${id}.`); // null = a persona without a prompt.md
    }
    if (over.memory != null) {
      await this.write(`tickets/_meta/personas/${id}/memory.md`, over.memory);
    }
  }

  /** A persona of `kind` (`human` parks, `agent` runs) — the manual-step specs' (E10-6). */
  async writeHuman(id = 'you', kind = 'human'): Promise<void> {
    await this.write(`tickets/_meta/personas/${id}/persona.md`, ['---', `title: ${id === 'you' ? 'You' : id}`, `kind: ${kind}`, 'role: custom', 'worker: opencode', '---', ''].join('\n'));
  }
}
