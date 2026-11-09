import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../../fleet/harness/contract';
import { claudeCodeMcpLaunch } from '../../fleet/harness/claude-code';
import { composeVaultMcp } from './compose-vault-mcp';
import type { VaultMcpComponent } from './vault-mcp-component';

/**
 * req-167 against the real thing: the service's vault MCP endpoint on a
 * loopback port, two vaults on disk, and the official MCP SDK client
 * connecting with a worker's token — `vault_read` succeeds, a `vault_write`
 * to a vault the persona may not write is refused, both land on the run's
 * stream; an unknown token is turned away. No engine, no service home: the
 * component is composed over a config stub and a persona stub.
 */
let root: string;
let component: VaultMcpComponent;
let events: NormalizedEvent[];

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-vault-mcp-'));
  await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
  await fsp.mkdir(path.join(root, 'work'), { recursive: true });
  await fsp.writeFile(path.join(root, 'notes', 'a.md'), '# A\n\nalpha\n');
  events = [];
  const vaults = [
    { id: 'notes', name: 'Notes', path: path.join(root, 'notes'), active: true },
    { id: 'work', name: 'Work', path: path.join(root, 'work'), active: false },
  ];
  const personas = [{ id: 'ben', allowed: { spendAboveAllowance: false, writeVaults: ['work'] } }];
  component = composeVaultMcp({
    config: { get: async <T>(key: string) => (key === 'vaults.registered' ? (vaults as T) : undefined) },
    invoke: () => async () => personas,
    hostedVault: path.join(root, 'notes'),
    build: 'spec',
    log: () => undefined,
    onChange: () => undefined,
  });
  await component.start();
});

afterEach(async () => {
  await component.stop();
  await fsp.rm(root, { recursive: true, force: true });
});

async function connect(url: string, token: string): Promise<Client> {
  const client = new Client({ name: 'worker-spec', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

const textOf = (result: Awaited<ReturnType<Client['callTool']>>): string => (result.content as { text: string }[]).map((c) => c.text).join('\n');

describe('the vault MCP endpoint over the MCP SDK (req-167)', () => {
  it('serves a worker with its own token: reads everywhere, a refused write comes back as the Error the model acts on', async () => {
    const runDir = path.join(root, 'runs', 'run-1');
    const access = component.open(
      { runId: 'run-1', ticketId: 'T-1', persona: 'ben', readOnly: false, runDir, harness: 'Claude Code', emit: (e) => events.push(e) },
      claudeCodeMcpLaunch,
    )!;
    const config = JSON.parse(await fsp.readFile(path.join(runDir, 'mcp.json'), 'utf8')) as { mcpServers: { drey: { url: string; headers: { Authorization: string } } } };
    const { url, headers } = config.mcpServers.drey;
    const client = await connect(url, headers.Authorization.slice('Bearer '.length));

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).not.toContain('vault_delete');

    const read = await client.callTool({ name: 'vault_read', arguments: { path: 'a.md', vault: 'notes' } });
    expect(textOf(read)).toContain('3: alpha');

    const refused = await client.callTool({ name: 'vault_write', arguments: { path: 'x.md', content: 'x', mode: 'create', vault: 'notes' } });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toBe('Error: ben may not write vault "notes" (allowed: read)');
    await expect(fsp.stat(path.join(root, 'notes', 'x.md'))).rejects.toThrow();

    expect(events.map((e) => e.audit?.verdict)).toEqual(['allowed', 'refused']);
    await client.close();

    access.close();
    await expect(fsp.stat(path.join(runDir, 'mcp.json'))).rejects.toThrow();
    await expect(connect(url, headers.Authorization.slice('Bearer '.length))).rejects.toThrow(/401|token/i);
  });

  it('turns away a request without a known token before any tool runs', async () => {
    const port = component.record().port!;
    const reply = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer guess' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(reply.status).toBe(401);
  });
});
