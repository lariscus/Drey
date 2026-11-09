import { describe, expect, it } from 'vitest';
import type { NormalizedEvent, ProviderAdapter, ProviderStart, WorkerHandle, WorkerMcpServer } from '../harness/contract';
import type { LiveRun } from './live-run';
import { ProcessSupervisor, type ProcessSupervisorDeps } from './process-supervisor';
import type { VaultGrantRequest, WorkerVaultGate } from './worker-vault';

/**
 * req-167: the one spawn path opens the worker's vault before the spawn —
 * the persona and the read-only flag of the run, the run's own folder — hands
 * the adapter its launch, and closes the access when the worker exits.
 */
function harness(withMcp: boolean) {
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
    request: { ticketId: 'T-1', model: null, permissionMode: 'read-only', instruction: 'x' },
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
});
