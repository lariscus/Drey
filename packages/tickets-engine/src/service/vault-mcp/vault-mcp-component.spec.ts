import { describe, expect, it } from 'vitest';
import type { NormalizedEvent, WorkerMcpServer } from '../../fleet/harness/contract';
import type { VaultGrantRequest } from '../../fleet/runner/worker-vault';
import { MemoryVaultDisk } from './memory-vault-disk.fake';
import { ProjectRights } from './project-rights';
import { RunTokens } from './run-tokens';
import { VaultCallAuditor } from './vault-call-auditor';
import { VaultMcpCalls } from './vault-mcp-calls';
import { VaultMcpComponent } from './vault-mcp-component';

/** req-167: the `mcp` component — its row in `service.lock`, and the gate a worker's spawn opens. */
function harness(listen: () => Promise<number> = async () => 4711) {
  const written = new Map<string, string>();
  const removed: string[] = [];
  let tokenNo = 0;
  const tokens = new RunTokens({ token: () => `tok-${++tokenNo}`, hash: (t) => `#${t}` });
  const calls = new VaultMcpCalls({
    vaults: { current: async () => [] },
    disk: new MemoryVaultDisk(),
    rights: new ProjectRights({ projects: async () => [], writesNotes: async () => false }, new MemoryVaultDisk()),
    auditor: new VaultCallAuditor({ now: () => new Date(0), log: () => undefined }),
  });
  let changes = 0;
  const component = new VaultMcpComponent({
    endpoint: () => ({ listen, close: async () => undefined }),
    tokens,
    calls,
    files: { write: (file, text) => written.set(file, text), remove: (file) => removed.push(file) },
    now: () => new Date('2026-11-09T12:00:00Z'),
    log: () => undefined,
    onChange: () => changes++,
  });
  const events: NormalizedEvent[] = [];
  const request: VaultGrantRequest = { runId: 'run-1', ticketId: 'T-1', persona: 'ben', readOnly: false, scope: { kind: 'project', project: 'drey' }, runDir: 'R:/runs/run-1', harness: 'Claude Code', emit: (e) => events.push(e) };
  const describeAsFile = (server: WorkerMcpServer) => ({ files: [{ path: `${server.runDir}/mcp.json`, text: server.token }], args: ['--mcp-config'], acpServers: [] });
  return { component, tokens, written, removed, events, request, describeAsFile, changes: () => changes };
}

describe('VaultMcpComponent (req-167)', () => {
  it('is starting until it listens, then running with its port and the live workers', async () => {
    const h = harness();
    expect(h.component.record()).toEqual({ state: 'starting', detail: null });
    await h.component.start();
    expect(h.component.record()).toEqual({ state: 'running', detail: '127.0.0.1:4711 · 0 workers', port: 4711 });
    expect(h.changes()).toBe(1);
  });

  it('is failed with the reason when it cannot listen', async () => {
    const h = harness(() => Promise.reject(new Error('EADDRINUSE')));
    await h.component.start();
    expect(h.component.record()).toEqual({ state: 'failed', detail: 'EADDRINUSE' });
  });

  it('mints a token per worker, writes the harness file with it, and resolves it to the run', async () => {
    const h = harness();
    await h.component.start();
    const access = h.component.open(h.request, h.describeAsFile)!;
    expect(access.launch.args).toEqual(['--mcp-config']);
    expect(h.written.get('R:/runs/run-1/mcp.json')).toBe('tok-1');
    expect(h.component.resolve('tok-1')?.grant).toEqual(expect.objectContaining({ runId: 'run-1', persona: 'ben', readOnly: false }));
    expect(h.component.record().detail).toBe('127.0.0.1:4711 · 1 worker');
  });

  it('hands the harness the endpoint address and the server name', async () => {
    const h = harness();
    await h.component.start();
    let seen: WorkerMcpServer | null = null;
    h.component.open(h.request, (server) => {
      seen = server;
      return { files: [], args: [], acpServers: [] };
    });
    expect(seen).toEqual({ name: 'drey', url: 'http://127.0.0.1:4711/mcp', token: 'tok-1', runDir: 'R:/runs/run-1' });
  });

  it('closing kills the token and removes the file', async () => {
    const h = harness();
    await h.component.start();
    h.component.open(h.request, h.describeAsFile)!.close();
    expect(h.component.resolve('tok-1')).toBeNull();
    expect(h.removed).toEqual(['R:/runs/run-1/mcp.json']);
    expect(h.tokens.live).toBe(0);
  });

  it('a harness without MCP, or a component that does not listen, gives no vault and says so once on the stream', async () => {
    const h = harness();
    expect(h.component.open(h.request, h.describeAsFile)).toBeNull();
    await h.component.start();
    expect(h.component.open(h.request, null)).toBeNull();
    expect(h.events.map((e) => e.text)).toEqual(['the vault MCP is not listening — this run has no vault', 'Claude Code takes no MCP configuration — this run has no vault']);
    expect(h.tokens.live).toBe(0);
  });

  it('a config file that cannot be written gives no vault and leaves no live token', async () => {
    const h = harness();
    await h.component.start();
    const failing = (server: WorkerMcpServer) => ({ files: [{ path: `${server.runDir}/mcp.json`, text: 'x' }], args: [], acpServers: [] });
    const component = h.component as unknown as { deps: { files: { write: () => void } } };
    component.deps.files.write = () => {
      throw new Error('EACCES');
    };
    expect(h.component.open(h.request, failing)).toBeNull();
    expect(h.tokens.live).toBe(0);
    expect(h.events.at(-1)!.text).toContain('could not be written');
  });
});
