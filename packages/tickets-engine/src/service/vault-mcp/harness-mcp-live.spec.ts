import { execFileSync, spawn as spawnChild } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claudeCodeMcpLaunch } from '../../fleet/harness/claude-code';
import type { NormalizedEvent, ProviderAdapter, WorkerHandle } from '../../fleet/harness/contract';
import { kimiAdapter } from '../../fleet/harness/kimi';
import { opencodeAdapter } from '../../fleet/harness/opencode';
import { nodeSpawnFn } from '../../fleet/procs';
import { composeVaultMcp } from './compose-vault-mcp';
import type { VaultMcpComponent } from './vault-mcp-component';

/**
 * req-167 against the installed harnesses (opt-in: `DREY_LIVE_MCP=1`; each
 * block skips when its CLI is missing). The service's real vault MCP
 * endpoint, a worker's real configuration, and the CLI started the way the
 * runner starts it — with no prompt, so no model is called and nothing is
 * spent: the proof is that the harness connects to the endpoint with its own
 * token on its own (the endpoint counts the requests a live token makes).
 * Data homes are temporary where the CLI allows it (opencode's
 * `XDG_DATA_HOME`); Kimi and Claude Code start with the user's login,
 * because opening a session reads it — neither writes a turn.
 */
const LIVE = process.env['DREY_LIVE_MCP'] === '1';
const homes: string[] = [];

function installed(cmd: string): boolean {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32', timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'drey-mcp-live-'));
  homes.push(dir);
  return dir;
}

// A CLI's own helper may hold its folder a moment after the tree kill; a temp folder it still holds is left to the OS.
afterAll(() =>
  homes.forEach((dir) => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // held by a CLI helper that is still on its way out
    }
  }),
);

let component: VaultMcpComponent;
let hits: string[];

beforeEach(async () => {
  const vault = tempDir();
  writeFileSync(path.join(vault, 'a.md'), '# A\n');
  hits = [];
  component = composeVaultMcp({
    config: { get: async <T>() => undefined as T },
    invoke: () => async () => [],
    hostedVault: vault,
    build: 'live',
    log: () => undefined,
    onChange: () => undefined,
  });
  const resolve = component.resolve.bind(component);
  component.resolve = (token) => {
    const session = resolve(token);
    if (session !== null) {
      hits.push(session.grant.runId);
    }
    return session;
  };
  await component.start();
});

afterEach(() => component.stop());

const until = async (done: () => boolean, ms: number): Promise<void> => {
  const end = Date.now() + ms;
  while (!done() && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

function quietStart(adapter: ProviderAdapter, env: Record<string, string>): { handle: WorkerHandle; events: NormalizedEvent[] } {
  const events: NormalizedEvent[] = [];
  const runDir = tempDir();
  const access = component.open({ runId: `live-${adapter.id}`, ticketId: 'T-0', persona: null, readOnly: false, runDir, harness: adapter.label, emit: (e) => events.push(e) }, adapter.mcpLaunch!.bind(adapter))!;
  const handle = adapter.spawn({ cwd: tempDir(), instruction: 'unused', model: null, permissionMode: 'read-only', resumeRef: null, ticketId: 'T-0', holdAtSpawn: true, env, mcp: access.launch, onEvent: (e) => events.push(e), onSessionRef: () => undefined });
  return { handle, events };
}

describe.skipIf(!LIVE || !installed('opencode'))('opencode 2.0.32 connects to the vault MCP (live)', () => {
  it('opens its session with the server and calls the endpoint with its token', async () => {
    const { handle, events } = quietStart(opencodeAdapter(nodeSpawnFn()), { XDG_DATA_HOME: tempDir() });
    await until(() => hits.length > 0, 45_000);
    await handle.stop();
    await handle.exited;
    expect(events.filter((e) => e.text?.includes('no vault'))).toEqual([]);
    expect(hits).toContain('live-opencode');
  });
});

describe.skipIf(!LIVE || !installed('kimi'))('Kimi 2.5.2 connects to the vault MCP (live)', () => {
  it('opens its session with the server and calls the endpoint with its token', async () => {
    const { handle, events } = quietStart(kimiAdapter(nodeSpawnFn()), {});
    await until(() => hits.length > 0, 45_000);
    await handle.stop();
    await handle.exited;
    expect(events.filter((e) => e.text?.includes('no vault'))).toEqual([]);
    expect(hits).toContain('live-kimi');
  });
});

describe.skipIf(!LIVE || !installed('claude'))('Claude Code connects to the vault MCP (live)', () => {
  it('reads the --mcp-config file in the run folder and calls the endpoint with its token, before any prompt', async () => {
    const runDir = tempDir();
    const access = component.open({ runId: 'live-claude', ticketId: 'T-0', persona: null, readOnly: false, runDir, harness: 'Claude Code', emit: () => undefined }, claudeCodeMcpLaunch)!;
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', ...access.launch.args];
    const child = spawnChild('claude', args, { cwd: tempDir(), stdio: ['pipe', 'ignore', 'ignore'] });
    await until(() => hits.length > 0, 45_000);
    const gone = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await gone;
    access.close();
    expect(hits).toContain('live-claude');
  });
});
