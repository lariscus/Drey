import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '../ports/memory-file-system.fake';
import type { SpawnFn } from '../ports/process-spawner';
import { AcpProbe, ACP_PROBE_TARGETS, acpModelsOf } from './probe-acp';
import { BinaryLocator } from './probe-binary';
import { CLAUDE_PROBE_ARGS, ClaudeCodeProbe, claudeOutcomeOf } from './probe-claude-code';
import { fakeProcess, type FakeProcess } from './worker-process.fake';

const ticks = async (n = 6): Promise<void> => {
  for (let i = 0; i < n; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

/** Claude Code 2.1.319's `initialize` reply, as measured on 2026-11-13 (trimmed). */
const CLAUDE_INIT = {
  claude_code_version: '2.1.319',
  account: { tokenSource: 'claude.ai', apiProvider: 'firstParty' },
  models: [
    { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: 'Use the default model (currently Opus 5.5) · $4/$20 per Mtok' },
    { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus', description: 'Opus 5.5 · Best for everyday, complex tasks · $4/$20 per Mtok' },
    { value: 'fable', resolvedModel: 'claude-fable-5-2', displayName: 'Fable', description: 'Fable 5.2 · Most capable · $10/$50 per Mtok' },
    { value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku', description: 'Haiku 5.5 · Fastest for quick answers' },
  ],
};

function locatorWith(...files: string[]): BinaryLocator {
  const fs = new MemoryFileSystem();
  for (const file of files) {
    void fs.writeText(file, '');
  }
  return new BinaryLocator(fs, { PATH: '/bin;/usr/bin', PATHEXT: '.EXE;.CMD' }, true);
}

describe('BinaryLocator — installed or not, without spawning (req-286)', () => {
  it('finds a command in a PATH folder, with a PATHEXT ending on Windows', async () => {
    const locator = locatorWith('/usr/bin/opencode.cmd');
    expect(await locator.find('opencode')).toBe('/usr/bin/opencode.cmd');
    expect(await locator.find('copilot')).toBeNull();
  });

  it('POSIX: the bare name in a `:`-separated PATH', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeText('/home/u/.local/bin/claude', '');
    expect(await new BinaryLocator(fs, { PATH: '/usr/bin:/home/u/.local/bin' }, false).find('claude')).toBe('/home/u/.local/bin/claude');
  });
});

describe('ClaudeCodeProbe — Claude Code’s own model list (req-286)', () => {
  it('reads version, account and each distinct resolved model, named by its description', () => {
    expect(claudeOutcomeOf(CLAUDE_INIT)).toEqual({
      installed: true,
      version: '2.1.319',
      signedIn: true,
      models: [
        { model: 'claude-opus-5-5', name: 'Opus 5.5' },
        { model: 'claude-fable-5-2', name: 'Fable 5.2' },
        { model: 'claude-haiku-5-5', name: 'Haiku 5.5' },
      ],
      error: null,
    });
    expect(claudeOutcomeOf({ ...CLAUDE_INIT, account: { tokenSource: 'none' } }).signedIn).toBe(false);
  });

  it('asks initialize on stream-json, before any turn, and ends the process', async () => {
    const proc = fakeProcess();
    const spawned: Array<{ cmd: string; args: readonly string[] }> = [];
    const spawnFn: SpawnFn = (cmd, args) => (spawned.push({ cmd, args }), proc);
    const pending = new ClaudeCodeProbe(spawnFn, locatorWith('/bin/claude.exe'), '/home/discovery').probe();
    await ticks();
    expect(spawned).toEqual([{ cmd: 'claude', args: CLAUDE_PROBE_ARGS }]);
    expect(JSON.parse(proc.stdinWrites[0]!)).toEqual({ type: 'control_request', request_id: 'drey-probe', request: { subtype: 'initialize' } });
    proc.stdout(JSON.stringify({ type: 'system', subtype: 'noise' }));
    proc.stdout(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'drey-probe', response: CLAUDE_INIT } }));
    const outcome = await pending;
    expect(outcome.models).toHaveLength(3);
    expect(proc.stdinWrites.at(-1)).toBe('<<end>>');
    expect(proc.killTree).toHaveBeenCalled();
  });

  it('not on PATH: not installed, nothing spawned', async () => {
    const spawnFn: SpawnFn = () => {
      throw new Error('must not spawn');
    };
    expect(await new ClaudeCodeProbe(spawnFn, locatorWith(), '/x').probe()).toEqual({ installed: false, version: null, signedIn: null, models: [], error: null });
  });

  it('an exit before the answer, or no answer in time, is a failed probe', async () => {
    const proc = fakeProcess();
    const pending = new ClaudeCodeProbe(() => proc, locatorWith('/bin/claude.exe'), '/x').probe();
    await ticks();
    proc.exit(1);
    expect((await pending).error).toBe('Claude Code exited (1) before it answered');
    const silent = fakeProcess();
    expect((await new ClaudeCodeProbe(() => silent, locatorWith('/bin/claude.exe'), '/x', 5).probe()).error).toBe('Claude Code did not answer initialize');
  });
});

/** An ACP agent that answers initialize and session/new as scripted. */
function acpAgent(proc: FakeProcess, init: Record<string, unknown>, session: { result?: Record<string, unknown>; error?: { message: string } }): string[] {
  const methods: string[] = [];
  let read = 0;
  const pump = setInterval(() => {
    while (read < proc.stdinWrites.length) {
      const message = JSON.parse(proc.stdinWrites[read++]!) as { id: number; method: string };
      methods.push(message.method);
      const answer = message.method === 'initialize' ? { result: init } : message.method === 'session/new' ? session : { result: {} };
      proc.stdout(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...answer }));
    }
  }, 1);
  setTimeout(() => clearInterval(pump), 500);
  return methods;
}

describe('AcpProbe — the models of `session/new` (req-286)', () => {
  const opencode = ACP_PROBE_TARGETS[0]!;

  it('opencode 2.0.32: the model config option’s values; the probe’s session is deleted again', async () => {
    const proc = fakeProcess();
    const init = { agentInfo: { name: 'OpenCode', version: '2.0.32' }, agentCapabilities: { sessionCapabilities: { delete: {} } } };
    const session = { result: { sessionId: 's1', configOptions: [{ id: 'model', category: 'model', currentValue: 'zai-coding-plan/glm-5.3', options: [{ value: 'zai-coding-plan/glm-5.3', name: 'GLM-5.3' }, { value: 'github-copilot/gpt-5.4', name: 'GPT-5.4' }] }, { id: 'mode', options: [{ value: 'build' }] }] } };
    const methods = acpAgent(proc, init, session);
    const outcome = await new AcpProbe(opencode, () => proc, locatorWith('/bin/opencode.cmd'), { cwd: '/home/discovery' }).probe();
    expect(outcome).toEqual({
      installed: true,
      version: '2.0.32',
      signedIn: true,
      models: [
        { model: 'zai-coding-plan/glm-5.3', name: 'GLM-5.3' },
        { model: 'github-copilot/gpt-5.4', name: 'GPT-5.4' },
      ],
      error: null,
    });
    expect(methods).toEqual(['initialize', 'session/new', 'session/delete']);
    expect(proc.killTree).toHaveBeenCalled();
  });

  it('Kimi signed out: session/new refused for authentication', async () => {
    const proc = fakeProcess();
    acpAgent(proc, { agentInfo: { name: 'Kimi Code CLI', version: '2.5.2' } }, { error: { message: 'Authentication required' } });
    expect(await new AcpProbe(ACP_PROBE_TARGETS[1]!, () => proc, locatorWith('/bin/kimi.exe'), { cwd: '/x' }).probe()).toEqual({ installed: true, version: '2.5.2', signedIn: false, models: [], error: null });
  });

  it('reads ACP’s models.availableModels too, each model once', () => {
    expect(acpModelsOf({ models: { availableModels: [{ modelId: 'kimi-k3.1-pro', name: 'K3.1 Pro' }, { modelId: 'kimi-k2.5' }] }, configOptions: [{ id: 'model', options: [{ value: 'kimi-k3.1-pro' }] }] })).toEqual([
      { model: 'kimi-k3.1-pro', name: null },
      { model: 'kimi-k2.5', name: null },
    ]);
  });

  it('Copilot CLI not on PATH: not installed', async () => {
    expect((await new AcpProbe(ACP_PROBE_TARGETS[2]!, () => fakeProcess(), locatorWith(), { cwd: '/x' }).probe()).installed).toBe(false);
  });
});
