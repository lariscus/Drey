import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NormalizedEvent, WorkerMcpServer } from '../fleet/harness/contract';
import { ONE_ON_ONE_VAULT_TOOLS } from '../fleet/one-on-one-toolset';
import type { VaultScope, WorkerVaultGate } from '../fleet/orchestrate/worker-vault';
import type { Args, RunnerDeps, RunnerHandle } from '../fleet/runner';
import type { PathsChange } from '../server/drey-port';
import type { Engine, EngineOptions } from '../server/engine';
import { ServiceHost } from './service-host';
import { readServiceLock } from './service-lock';

/**
 * req-213 and req-217 through the service host itself: a worker with the
 * token the runner's gate minted writes a note over the real vault MCP and
 * the engine's paths channel is told (`Engine.emitPaths`); a 1:1's token
 * offers three read tools and changes nothing, and the engine got the seam
 * whose answer the 1:1's brief names. The engine and the runner are
 * stand-ins (service-host.spec's); the MCP endpoint, the tokens, the grant
 * and the disk are real.
 */
describe('ServiceHost — what a worker does in the vault', () => {
  let home = '';
  let notes = '';
  let work = '';
  let host: ServiceHost | null = null;
  let gate: WorkerVaultGate | null = null;
  let emitted: PathsChange[] = [];
  let engineOptions: EngineOptions | null = null;
  const clients: Client[] = [];

  const fakeEngine = async (opts: EngineOptions): Promise<Engine> => {
    engineOptions = opts;
    const registered = [
      { id: 'notes', name: 'Notes', path: notes, active: true },
      { id: 'work', name: 'Work', path: work, active: false },
    ];
    return {
      invokeUrl: 'http://127.0.0.1:4100',
      token: 'tok',
      config: {
        get: async (key: string) => (key === 'vaults.registered' ? registered : key === 'service.enabled' ? true : undefined),
        set: async () => undefined,
      } as never,
      ready: Promise.resolve(),
      // req-283: the project drey gives Notes to read and Work to write; ben may change notes.
      invoke: async (method: string) =>
        method === 'listPersonas'
          ? [{ id: 'ben', allowed: { spendAboveAllowance: false, writeNotes: true } }]
          : method === 'projectRecords'
            ? [{ id: 'drey', name: 'Drey', color: '', repos: [], folders: [], vaults: { Notes: 'read', Work: 'write' }, purpose: '' }]
            : null,
      onEvent: () => () => undefined,
      onPaths: () => () => undefined,
      emitPaths: (change: PathsChange) => emitted.push(change),
      dreyClients: () => 0,
      remoteStatus: () => ({ config: { enabled: false }, listening: null, error: null, deviceUrl: null, devices: [] }) as never,
      close: async () => undefined,
    } as Engine;
  };

  const fakeRunner = async (_args: Args, deps: RunnerDeps): Promise<RunnerHandle> => {
    gate = deps.vault ?? null;
    return {
      port: 1,
      token: 'rt',
      descriptorPath: '',
      descriptor: { port: 1, token: 'rt', pid: process.pid, startedAt: '', version: 1 },
      stop: async () => undefined,
    };
  };

  /** Opens a worker's access the way the spawn path does and connects the SDK client with its token. */
  const worker = async (request: { persona: string | null; readOnly: boolean; tools?: readonly string[]; scope?: VaultScope }): Promise<{ client: Client; events: NormalizedEvent[] }> => {
    let server: WorkerMcpServer | null = null;
    const events: NormalizedEvent[] = [];
    const access = gate!.open(
      { runId: 'run-1', ticketId: 'T-1', runDir: path.join(home, 'run-1'), harness: 'Claude Code', emit: (event) => events.push(event), scope: { kind: 'project', project: 'drey' }, ...request },
      (offered) => {
        server = offered;
        return { files: [], args: [], acpServers: [] };
      },
    );
    expect(access).not.toBeNull();
    const client = new Client({ name: 'worker-spec', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(server!.url), { requestInit: { headers: { Authorization: `Bearer ${server!.token}` } } }));
    clients.push(client);
    return { client, events };
  };

  const textOf = (result: Awaited<ReturnType<Client['callTool']>>): string => (result.content as { text: string }[]).map((c) => c.text).join('\n');

  beforeEach(async () => {
    home = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-service-vault-'));
    notes = path.join(home, 'notes');
    work = path.join(home, 'work');
    await fsp.mkdir(notes, { recursive: true });
    await fsp.mkdir(work, { recursive: true });
    await fsp.writeFile(path.join(work, 'w.md'), 'work one\n');
    emitted = [];
    gate = null;
    engineOptions = null;
    host = await ServiceHost.start({
      home: path.join(home, 'svc'),
      vaultPath: notes,
      clientDir: path.join(home, 'client'),
      build: 'spec',
      idleMs: 60_000,
      tickMs: 1_000,
      exit: () => undefined,
      createEngine: fakeEngine,
      startRunner: fakeRunner,
      applyAutostart: async () => undefined,
    });
    const lock = await readServiceLock(path.join(home, 'svc'));
    await fetch(`http://127.0.0.1:${lock!.port}/components/runner/start`, { method: 'POST', headers: { Authorization: `Bearer ${lock!.token}` } });
    for (let i = 0; i < 100 && gate === null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(gate).not.toBeNull();
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)));
    await host?.shutdown({ handover: false });
    host = null;
    await fsp.rm(home, { recursive: true, force: true });
  });

  it("announces a worker's write, edit and move to the engine's paths channel, with the vault's folder (req-213)", async () => {
    const { client } = await worker({ persona: 'ben', readOnly: false });
    await client.callTool({ name: 'vault_read', arguments: { path: 'w.md', vault: 'work' } });
    expect(emitted).toEqual([]);
    await client.callTool({ name: 'vault_write', arguments: { path: 'n.md', content: 'new\n', mode: 'create', vault: 'work' } });
    expect(emitted).toEqual([{ vaultPath: work, changed: ['n.md'], deleted: [] }]);
    await client.callTool({ name: 'vault_edit', arguments: { path: 'w.md', vault: 'work', edits: [{ old_text: 'one', new_text: 'two' }] } });
    await client.callTool({ name: 'vault_move', arguments: { from: 'n.md', to: 'sub/n.md', vault: 'work' } });
    expect(emitted.slice(1)).toEqual([
      { vaultPath: work, changed: ['w.md'], deleted: [] },
      { vaultPath: work, changed: ['sub/n.md'], deleted: ['n.md'] },
    ]);
    expect(await fsp.readFile(path.join(work, 'w.md'), 'utf8')).toBe('work two\n');
  });

  it('announces nothing for a write the project leaves read-only (req-213)', async () => {
    const { client } = await worker({ persona: 'ben', readOnly: false });
    const refused = await client.callTool({ name: 'vault_write', arguments: { path: 'x.md', content: 'x', mode: 'create', vault: 'notes' } });
    expect(refused.isError).toBe(true);
    expect(emitted).toEqual([]);
  });

  it("a 1:1's token offers the three read tools, reads, and changes nothing (req-217)", async () => {
    const { client, events } = await worker({ persona: 'ben', readOnly: true, tools: ONE_ON_ONE_VAULT_TOOLS, scope: { kind: 'every-project' } });
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['vault_list', 'vault_search', 'vault_read']);
    expect(textOf(await client.callTool({ name: 'vault_read', arguments: { path: 'w.md', vault: 'work' } }))).toContain('1: work one');
    const refused = await client.callTool({ name: 'vault_write', arguments: { path: 'z.md', content: 'z', mode: 'create', vault: 'work' } });
    expect(refused.isError).toBe(true);
    await expect(fsp.stat(path.join(work, 'z.md'))).rejects.toThrow();
    expect(emitted).toEqual([]);
    expect(events.map((event) => event.tool)).toEqual(['mcp__drey__vault_read', 'mcp__drey__vault_write']);
  });

  it("a free session's token reaches its project: it writes where the project says Write and the persona may change notes (req-283)", async () => {
    const { client } = await worker({ persona: 'ben', readOnly: false });
    expect((await client.listTools()).tools).toHaveLength(6);
    const written = await client.callTool({ name: 'vault_write', arguments: { path: 'free.md', content: 'f\n', mode: 'create', vault: 'work' } });
    expect(written.isError).not.toBe(true);
  });

  it("hands the engine the seam whose answer the 1:1's brief names (req-217)", () => {
    const seam = engineOptions!.oneOnOneTools!;
    expect(seam.attached({ persona: 'ben', provider: 'claude-code' })).toEqual(ONE_ON_ONE_VAULT_TOOLS);
    expect(seam.attached({ persona: 'ben', provider: 'kimi' })).toEqual(['vault_list', 'vault_search', 'vault_read']);
    expect(seam.attached({ persona: 'ben', provider: null })).toEqual([]);
  });
});
