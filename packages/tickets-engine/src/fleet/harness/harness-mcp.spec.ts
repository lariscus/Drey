import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SpawnFn } from '../ports/process-spawner';
import { claudeCodeAdapter, claudeCodeArgs } from './claude-code';
import { ScriptedAcpAgent, type AcpAgentScript } from './contract-acp-agent.fake';
import { ContractProcess } from './contract-process.fake';
import type { NormalizedEvent, ProviderAdapter, ProviderStart, WorkerMcpServer } from './contract';
import { copilotAdapter } from './copilot';
import { kimiAdapter } from './kimi';
import { opencodeAdapter } from './opencode';

/**
 * req-167: how each harness takes Drey Service's vault MCP — one spec per
 * adapter's configuration, over fakes. Claude Code reads a `--mcp-config`
 * file in the run's folder; every ACP harness gets the server in the
 * session's `mcpServers` when `initialize` advertises HTTP MCP (opencode
 * 2.0.32 and Kimi 2.5.2 do, measured 2026-11-09), and says on the stream
 * when it does not.
 */
const SERVER: WorkerMcpServer = { name: 'drey', url: 'http://127.0.0.1:4711/mcp', token: 'tok-secret', runDir: path.join('R:', 'fleet', 'runs', 'run-1') };
const HTTP_MCP = { mcpCapabilities: { http: true, sse: false } };

const ticks = async (n = 8): Promise<void> => {
  for (let i = 0; i < n; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

function startOf(over: Partial<ProviderStart>, events: NormalizedEvent[]): ProviderStart {
  return { cwd: 'W:/kt', instruction: 'Do it.', model: null, permissionMode: 'accept-edits', resumeRef: null, ticketId: 'T-1', onEvent: (e) => events.push(e), onSessionRef: () => undefined, ...over };
}

function acpRun(factory: (spawn: SpawnFn) => ProviderAdapter, capabilities: Record<string, unknown>, over: Partial<ProviderStart> = {}) {
  const script: AcpAgentScript = { offer: {}, capabilities, questions: 'elicitation' };
  const agent = new ScriptedAcpAgent(script);
  const adapter = factory(() => agent.proc);
  const events: NormalizedEvent[] = [];
  adapter.spawn(startOf({ mcp: adapter.mcpLaunch!(SERVER), ...over }, events));
  const sent = (method: string): Array<Record<string, unknown>> =>
    agent.proc.writes.map((w) => JSON.parse(w) as { method?: string; params?: Record<string, unknown> }).filter((m) => m.method === method).map((m) => m.params ?? {});
  return { agent, events, sent, adapter };
}

describe('Claude Code takes the vault MCP as a config file (req-167)', () => {
  it('describes one file in the run folder with the bearer, and names it on the command line with the server allowed', () => {
    const launch = claudeCodeAdapter(new ContractProcess().spawnFn()).mcpLaunch!(SERVER);
    const file = path.join(SERVER.runDir, 'mcp.json');
    expect(launch.files.map((f) => f.path)).toEqual([file]);
    expect(JSON.parse(launch.files[0]!.text)).toEqual({ mcpServers: { drey: { type: 'http', url: SERVER.url, headers: { Authorization: 'Bearer tok-secret' } } } });
    expect(launch.args).toEqual(['--mcp-config', file, '--allowedTools', 'mcp__drey']);
    expect(launch.acpServers).toEqual([]);
  });

  it('spawns with those arguments and never the token on the command line', () => {
    const proc = new ContractProcess();
    const spawned: string[][] = [];
    const adapter = claudeCodeAdapter((cmd, args) => {
      spawned.push([...args]);
      return proc;
    });
    adapter.spawn(startOf({ mcp: adapter.mcpLaunch!(SERVER) }, []));
    expect(spawned[0]!.slice(-4)).toEqual(['--mcp-config', path.join(SERVER.runDir, 'mcp.json'), '--allowedTools', 'mcp__drey']);
    expect(spawned[0]!.join(' ')).not.toContain('tok-secret');
    expect(claudeCodeArgs(startOf({}, []))).not.toContain('--mcp-config');
  });
});

describe.each([
  ['opencode', (spawn: SpawnFn) => opencodeAdapter(spawn), 'opencode'],
  ['Kimi', (spawn: SpawnFn) => kimiAdapter(spawn), 'kimi'],
  ['Copilot CLI', (spawn: SpawnFn) => copilotAdapter(spawn), 'copilot'],
])('%s takes the vault MCP over ACP (req-167)', (_name, factory, agentName) => {
  it('opens the session with the server and its bearer header when initialize offers HTTP MCP', async () => {
    const r = acpRun(factory, HTTP_MCP);
    await ticks();
    expect(r.sent('session/new')[0]!['mcpServers']).toEqual([
      { type: 'http', name: 'drey', url: SERVER.url, headers: [{ name: 'Authorization', value: 'Bearer tok-secret' }] },
    ]);
    expect(r.adapter.mcpLaunch!(SERVER).files).toEqual([]);
  });

  it('opens without it and says once on the stream when the agent offers none', async () => {
    const r = acpRun(factory, {});
    await ticks();
    expect(r.sent('session/new')[0]!['mcpServers']).toEqual([]);
    expect(r.events.filter((e) => e.text?.includes('this run has no vault'))).toEqual([
      expect.objectContaining({ kind: 'note', detail: 'runner', text: `${agentName} offers no HTTP MCP server at initialize — this run has no vault` }),
    ]);
  });

  it('a resumed session takes it too', async () => {
    const r = acpRun(factory, { ...HTTP_MCP, loadSession: true, sessionCapabilities: { resume: {} } }, { resumeRef: 'ses_old' });
    await ticks(40);
    const resumed = [...r.sent('session/resume'), ...r.sent('session/load')];
    expect(resumed[0]!['mcpServers']).toEqual([expect.objectContaining({ name: 'drey', url: SERVER.url })]);
  });

  it('a run without the vault opens with none and says nothing', async () => {
    const agent = new ScriptedAcpAgent({ offer: {}, capabilities: HTTP_MCP, questions: 'elicitation' });
    const events: NormalizedEvent[] = [];
    factory(() => agent.proc).spawn(startOf({}, events));
    await ticks();
    const opened = agent.proc.writes.map((w) => JSON.parse(w) as { method?: string; params?: Record<string, unknown> }).find((m) => m.method === 'session/new');
    expect(opened!.params!['mcpServers']).toEqual([]);
    expect(events.some((e) => e.text?.includes('no vault'))).toBe(false);
  });
});
