import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NormalizedEvent, WorkerMcpServer } from '../fleet/harness/contract';
import type { PersonaRecordsChannel } from '../fleet/orchestrate/engine-round-records';
import { settled, waitFor } from '../fleet/orchestrate/run-spec-support';
import { harness, runRequest, startRun, useTempDirs, type Harness } from '../fleet/orchestrate/supervisor-harness.fake';
import type { WorkerVaultGate } from '../fleet/orchestrate/worker-vault';
import type { Args, RunnerDeps, RunnerHandle } from '../fleet/runner';
import { createEngine, type Engine, type EngineOptions } from '../server/engine';
import { ServiceHost } from './service-host';
import { readServiceLock } from './service-lock';

const run = promisify(execFile);

/**
 * req-225 and req-226 through Drey Service itself, in a temp HOME: the real
 * engine over a git vault (its default crew seeded), the real vault MCP over
 * HTTP, the runner's real closing round. A worker's `memory_write` lands in
 * Ben's `memory.md` as its own commit; the run's closing round then writes
 * its journal entry as ONE commit `personas: ben closing round T-0001` and
 * does not repeat the lesson. Only the harness process is a fake.
 */
describe('Drey Service — the run writes its persona records as commits (req-225, req-226)', () => {
  const dirs = useTempDirs();
  let root = '';
  let vault = '';
  let host: ServiceHost | null = null;
  let engine: Engine | null = null;
  let gate: WorkerVaultGate | null = null;
  let channel: PersonaRecordsChannel | null = null;
  const saved = { HOME: process.env['HOME'], USERPROFILE: process.env['USERPROFILE'] };
  const clients: Client[] = [];

  const git = async (args: string[]): Promise<string> => (await run('git', args, { cwd: vault })).stdout;
  const subjects = async (): Promise<string[]> => (await git(['log', '--format=%s'])).trim().split('\n');
  const memory = (): Promise<string> => fsp.readFile(path.join(vault, 'tickets/_meta/personas/ben/memory.md'), 'utf8').catch(() => '');

  const fakeRunner = async (_args: Args, deps: RunnerDeps): Promise<RunnerHandle> => {
    gate = deps.vault ?? null;
    channel = deps.personaRecords ?? null;
    return { port: 1, token: 'rt', descriptorPath: '', descriptor: { port: 1, token: 'rt', pid: process.pid, startedAt: '', version: 1 }, stop: async () => undefined };
  };

  /** A ticket run's worker of Ben, its token minted the way the spawn path mints it. */
  const worker = async (): Promise<{ client: Client; events: NormalizedEvent[] }> => {
    let server: WorkerMcpServer | null = null;
    const events: NormalizedEvent[] = [];
    const access = gate!.open(
      { runId: 'run-1', ticketId: 'T-0001', persona: 'ben', readOnly: false, scope: { kind: 'project', project: null }, records: { harness: 'opencode', model: 'sonnet' }, runDir: path.join(root, 'run-1'), harness: 'opencode', emit: (event) => events.push(event) },
      (offered) => {
        server = offered;
        return { files: [], args: [], acpServers: [] };
      },
    );
    expect(access).not.toBeNull();
    const client = new Client({ name: 'records-spec', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(server!.url), { requestInit: { headers: { Authorization: `Bearer ${server!.token}` } } }));
    clients.push(client);
    return { client, events };
  };

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-service-records-'));
    process.env['HOME'] = path.join(root, 'user');
    process.env['USERPROFILE'] = path.join(root, 'user');
    vault = path.join(root, 'vault');
    await fsp.mkdir(path.join(vault, 'tickets/_meta'), { recursive: true });
    await fsp.mkdir(path.join(root, 'client'), { recursive: true });
    await fsp.mkdir(path.join(root, 'user'), { recursive: true });
    await fsp.writeFile(path.join(vault, 'tickets/_meta/pipeline.md'), '---\nphases:\n  - { id: inbox, title: Inbox, handover: manual }\n  - { id: done, title: Done, handover: none }\n---\n', 'utf8');
    await git(['init', '-b', 'main']);
    await git(['config', 'user.name', 'spec']);
    await git(['config', 'user.email', 'spec@example.com']);
    await git(['add', '-A']);
    await git(['commit', '-m', 'seed']);
    host = await ServiceHost.start({
      home: path.join(root, 'svc'),
      vaultPath: vault,
      clientDir: path.join(root, 'client'),
      build: 'spec',
      idleMs: 60_000,
      tickMs: 1_000,
      exit: () => undefined,
      createEngine: async (opts: EngineOptions) => (engine = await createEngine(opts)),
      startRunner: fakeRunner,
      applyAutostart: async () => undefined,
    });
    await engine!.ready; // the default crew is seeded (Ben exists) and committed
    const lock = await readServiceLock(path.join(root, 'svc'));
    await fetch(`http://127.0.0.1:${lock!.port}/components/runner/start`, { method: 'POST', headers: { Authorization: `Bearer ${lock!.token}` } });
    await waitFor(() => expect(gate).not.toBeNull());
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)));
    await host?.shutdown({ handover: false });
    host = null;
    engine = null;
    gate = null;
    channel = null;
    process.env['HOME'] = saved.HOME;
    process.env['USERPROFILE'] = saved.USERPROFILE;
    await fsp.rm(root, { recursive: true, force: true });
  });

  it("a worker's memory_write is its own commit, and the closing round lands as one commit without repeating the lesson", async () => {
    const { client, events } = await worker();
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['memory_write', 'journal_write']));
    const written = await client.callTool({ name: 'memory_write', arguments: { lesson: "run the repo's verify script, not vitest directly" } });
    expect(written.isError).not.toBe(true);
    expect(await memory()).toMatch(/- \d{4}-\d{2}-\d{2} · T-0001 · ben\/sonnet · run the repo's verify script, not vitest directly\n/);
    expect((await subjects())[0]).toBe('personas: ben memory +1 (T-0001)');
    const audit = events.find((event) => event.detail === 'audit')!;
    expect(audit).toMatchObject({ tool: 'mcp__drey__memory_write', audit: { persona: 'ben', verdict: 'allowed' } });

    // The run's closing round, over the channel Drey Service handed the runner; the vault MCP's audit line reaches the run's stream.
    const h: Harness = harness(dirs.fleet, { execShell: () => Promise.reject(new Error('exit 1')), personaRecords: channel! });
    const id = await startRun(h.sup, runRequest(vault, { model: 'sonnet' }), 'ben');
    h.adapter.starts[0]!.onSessionRef('sess-1');
    h.adapter.handles[0]!.emit(audit);
    h.adapter.handles[0]!.result();
    h.adapter.handles[0]!.fail(1);
    await waitFor(() => expect(h.adapter.handles).toHaveLength(2));
    h.adapter.handles[1]!.emit({ kind: 'result', text: JSON.stringify({ finding: { cause: 'prompt', text: 'the brief named no test command' }, friction: null, lesson: "run the repo's verify script, not vitest directly", proposal: null }) });
    h.adapter.handles[1]!.fail(0);
    await settled(h.sup, id, 'failed');

    expect((await subjects()).slice(0, 2)).toEqual(['personas: ben closing round T-0001', 'personas: ben memory +1 (T-0001)']);
    expect((await git(['show', '--name-only', '--format=', 'HEAD'])).trim()).toBe('tickets/_meta/personas/ben/reviews.md');
    expect((await memory()).match(/verify script/g)).toHaveLength(1);
    expect((await git(['status', '--porcelain', '--', 'tickets/_meta/personas'])).trim()).toBe('');
  });
});
