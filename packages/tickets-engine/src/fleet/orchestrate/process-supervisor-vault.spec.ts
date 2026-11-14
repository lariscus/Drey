import { describe, expect, it } from 'vitest';
import type { NormalizedEvent, ProviderAdapter, ProviderStart, WorkerHandle, WorkerMcpServer } from '../harness/contract';
import type { LiveRun } from './live-run';
import { ProcessSupervisor, type ProcessSupervisorDeps } from './process-supervisor';
import { ONE_ON_ONE_VAULT_TOOLS } from '../one-on-one-toolset';
import type { VaultGrantRequest, WorkerVaultGate } from './worker-vault';

/**
 * req-167: the one spawn path opens the worker's vault before the spawn —
 * the persona and the read-only flag of the run, the run's own folder — hands
 * the adapter its launch, and closes the access when the worker exits.
 */
function harness(withMcp: boolean, request: Record<string, unknown> = {}) {
  const starts: ProviderStart[] = [];
  let exit: (code: number | null) => void = () => undefined;
  const handle: WorkerHandle = { pid: 7, exited: new Promise((resolve) => (exit = resolve)), steer: async () => 'inject', stop: async () => undefined };
  const adapter: ProviderAdapter = {
    id: 'claude-code',
    label: 'Claude Code',
    liveInject: true,
    spawn: (start) => {
      starts.push(start);
      return handle;
    },
    ...(withMcp ? { mcpLaunch: (server: WorkerMcpServer) => ({ files: [], args: ['--mcp-config', `${server.runDir}/mcp.json`], acpServers: [] }) } : {}),
  };
  const requests: VaultGrantRequest[] = [];
  const described: Array<boolean> = [];
  let closed = 0;
  const gate: WorkerVaultGate = {
    open: (request, describe) => {
      requests.push(request);
      described.push(describe !== null);
      return describe === null ? null : { launch: describe({ name: 'drey', url: 'http://127.0.0.1:1/mcp', token: 't', runDir: request.runDir }), close: () => closed++ };
    },
  };
  const events: NormalizedEvent[] = [];
  const deps = {
    adapter,
    events: { onEvent: (_run: LiveRun, event: NormalizedEvent) => events.push(event) },
    background: { track: () => undefined },
    settings: { contextCap: () => undefined },
    onExit: async () => undefined,
    vault: gate,
  } as unknown as ProcessSupervisorDeps;
  const run = {
    info: { id: 'run-1', persona: 'ben', worktreePath: 'W:/kt' },
    request: { ticketId: 'T-1', model: null, permissionMode: 'read-only', instruction: 'x', ...request },
    dir: 'R:/runs/run-1',
    handle: null,
  } as unknown as LiveRun;
  return { supervisor: new ProcessSupervisor(deps), run, starts, requests, described, events, exit: (code: number | null) => exit(code), closed: () => closed };
}

describe('ProcessSupervisor and the vault (req-167)', () => {
  it('opens the access with the run, its persona, read-only flag and folder, and hands the adapter its launch', () => {
    const h = harness(true);
    h.supervisor.spawn(h.run, { instruction: 'x', resumeRef: null });
    expect(h.requests[0]).toEqual(expect.objectContaining({ runId: 'run-1', ticketId: 'T-1', persona: 'ben', readOnly: true, runDir: 'R:/runs/run-1', harness: 'Claude Code' }));
    expect(h.starts[0]!.mcp).toEqual({ files: [], args: ['--mcp-config', 'R:/runs/run-1/mcp.json'], acpServers: [] });
  });

  it('closes the access when the worker exits', async () => {
    const h = harness(true);
    h.supervisor.spawn(h.run, { instruction: 'x', resumeRef: null });
    expect(h.closed()).toBe(0);
    h.exit(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.closed()).toBe(1);
  });

  it('an adapter without mcpLaunch asks the gate with nothing to describe and spawns without a vault', () => {
    const h = harness(false);
    h.supervisor.spawn(h.run, { instruction: 'x', resumeRef: null });
    expect(h.described).toEqual([false]);
    expect(h.starts[0]!.mcp).toBeUndefined();
  });

  it('the call audit and the gate line reach the run stream through the request', () => {
    const h = harness(true);
    h.supervisor.spawn(h.run, { instruction: 'x', resumeRef: null });
    h.requests[0]!.emit({ ts: 't', kind: 'tool', detail: 'audit', tool: 'mcp__drey__vault_read' });
    expect(h.events).toEqual([expect.objectContaining({ detail: 'audit' })]);
  });

  it("offers a 1:1's token the read cut of the vault tools, read-only (req-217)", () => {
    const h = harness(true, { ticketId: '1:1', permissionMode: 'read-only', session: { kind: '1:1', persona: 'ben', workingDirectory: 'W:/kt', chatFile: 'c.md' } });
    h.supervisor.spawn(h.run, { instruction: 'x', resumeRef: null });
    expect(h.requests[0]).toEqual(expect.objectContaining({ persona: 'ben', readOnly: true, tools: ONE_ON_ONE_VAULT_TOOLS }));
    expect(ONE_ON_ONE_VAULT_TOOLS).toEqual(['vault_list', 'vault_search', 'vault_read']);
  });

  it("a free session gets the full set, read-only only when its mode says so (req-217)", () => {
    const h = harness(true, { ticketId: 'free', permissionMode: 'accept-edits', session: { kind: 'free', persona: 'ben', workingDirectory: 'W:/x' } });
    h.supervisor.spawn(h.run, { instruction: 'x', resumeRef: null });
    expect(h.requests[0]!.readOnly).toBe(false);
    expect(h.requests[0]!.tools).toBeUndefined();
  });

  it("a ticket run's persona may write its own memory line and journal note; a 1:1, a free session and a run without a persona may not (req-226)", () => {
    const recordsOf = (request: Record<string, unknown>, persona: string | null = 'ben'): VaultGrantRequest['records'] => {
      const h = harness(true, request);
      const run = { ...h.run, info: { ...h.run.info, persona, provider: 'claude-code', model: 'sonnet' } } as LiveRun;
      h.supervisor.spawn(run, { instruction: 'x', resumeRef: null });
      return h.requests[0]!.records;
    };
    expect(recordsOf({ permissionMode: 'accept-edits' })).toEqual({ harness: 'claude-code', model: 'sonnet' });
    expect(recordsOf({ ticketId: '1:1', session: { kind: '1:1', persona: 'ben', workingDirectory: 'W:/kt', chatFile: 'c.md' } })).toBeUndefined();
    expect(recordsOf({ ticketId: 'free', session: { kind: 'free', persona: 'ben', workingDirectory: 'W:/x' } })).toBeUndefined();
    expect(recordsOf({}, null)).toBeUndefined();
  });

  it('a ticket run is offered every vault tool', () => {
    const h = harness(true, { permissionMode: 'accept-edits' });
    h.supervisor.spawn(h.run, { instruction: 'x', resumeRef: null });
    expect(h.requests[0]!.tools).toBeUndefined();
  });
});

describe('ProcessSupervisor — the token carries the project (req-283)', () => {
  const scopeOf = (request: Record<string, unknown>): VaultGrantRequest['scope'] => {
    const h = harness(true, request);
    h.supervisor.spawn(h.run, { instruction: 'x', resumeRef: null });
    return h.requests[0]!.scope;
  };

  it("a ticket run and a free session reach their request's project; none named = no project", () => {
    expect(scopeOf({ projectId: 'drey' })).toEqual({ kind: 'project', project: 'drey' });
    expect(scopeOf({ ticketId: 'free', projectId: 'lariscus', session: { kind: 'free', persona: 'ben', workingDirectory: 'W:/x' } })).toEqual({ kind: 'project', project: 'lariscus' });
    expect(scopeOf({})).toEqual({ kind: 'project', project: null });
  });

  it('a 1:1 reads every project, whatever its request names', () => {
    expect(scopeOf({ ticketId: '1:1', projectId: 'drey', session: { kind: '1:1', persona: 'ben', workingDirectory: 'W:/kt', chatFile: 'c.md' } })).toEqual({ kind: 'every-project' });
  });
});
