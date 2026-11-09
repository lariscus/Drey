import { describe, expect, it } from 'vitest';
import type { SpawnFn } from '../ports/process-spawner';
import { ScriptedAcpAgent, type AcpAgentScript } from './contract-acp-agent.fake';
import type { NormalizedEvent, ProviderStart } from './contract';
import { opencodeAdapter } from './opencode';
import { opencodeModelSettings, stripVariant } from './opencode-settings';

/** opencode 2.0.32's offer and capabilities, as `opencode acp` sent them on 2026-11-09. */
const OFFER = {
  configOptions: [
    { id: 'model', category: 'model', type: 'select', currentValue: 'zai-coding-plan/glm-5.3', options: [] },
    { id: 'effort', category: 'thought_level', type: 'select', currentValue: 'default', options: [] },
    { id: 'mode', category: 'mode', type: 'select', currentValue: 'build', options: [{ value: 'build' }, { value: 'plan' }] },
  ],
};
const SCRIPT: AcpAgentScript = { offer: OFFER, capabilities: { loadSession: true, sessionCapabilities: { resume: {} } }, questions: 'elicitation' };

const ticks = async (n = 8): Promise<void> => {
  for (let i = 0; i < n; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

function run(over: Partial<ProviderStart> = {}, script: AcpAgentScript = SCRIPT) {
  const agent = new ScriptedAcpAgent(script);
  const events: NormalizedEvent[] = [];
  const spawned: Array<{ args: readonly string[]; env: Readonly<Record<string, string>> | undefined }> = [];
  const spawnFn: SpawnFn = (_cmd, args, opts) => {
    spawned.push({ args, env: opts.env });
    return agent.proc;
  };
  const start: ProviderStart = { cwd: 'W:/kt', instruction: 'Do it.', model: null, permissionMode: 'accept-edits', resumeRef: null, ticketId: 'T-1', onEvent: (e) => events.push(e), onSessionRef: () => undefined, ...over };
  const handle = opencodeAdapter(spawnFn).spawn(start);
  const sent = (method: string): Array<Record<string, unknown>> =>
    agent.proc.writes.map((w) => JSON.parse(w) as { method?: string; params?: Record<string, unknown> }).filter((m) => m.method === method).map((m) => m.params ?? {});
  return { agent, events, spawned, handle, sent };
}

describe('opencode over ACP (req-182)', () => {
  it('launches `opencode acp`; a pinned model with a context cap rides as inline config, and the stream says so', async () => {
    const plain = run();
    const capped = run({ model: 'zai/glm-5.3', contextCap: 120_000 });
    await ticks();
    expect(plain.spawned[0]).toEqual({ args: ['acp'], env: undefined });
    expect(capped.spawned[0]!.args).toEqual(['acp']);
    expect(JSON.parse(capped.spawned[0]!.env!['OPENCODE_CONFIG_CONTENT']!)).toEqual({ provider: { zai: { models: { 'glm-5.3': { limit: { context: 120_000, output: 30_000 } } } } } });
    expect(capped.events.some((e) => e.text?.startsWith('context cap: 120000 tokens'))).toBe(true);
  });

  it('a pin with a #variant sets the model and the variant as the effort the session offers', async () => {
    expect(stripVariant('zai/glm-5.3#high')).toBe('zai/glm-5.3');
    expect(opencodeModelSettings('zai/glm-5.3#high')).toEqual([{ configId: 'model', value: 'zai/glm-5.3' }, { configId: 'effort', value: 'high' }]);
    const r = run({ model: 'zai/glm-5.3#high' });
    await ticks();
    expect(r.sent('session/set_config_option')).toEqual([
      { sessionId: 'ses_a', configId: 'model', value: 'zai/glm-5.3' },
      { sessionId: 'ses_a', configId: 'effort', value: 'high' },
    ]);
  });

  it('a read-only start runs the plan agent; any other start keeps the default agent', async () => {
    const review = run({ permissionMode: 'read-only' });
    const build = run({ permissionMode: 'bypass' });
    await ticks();
    expect(review.sent('session/set_mode')).toEqual([{ sessionId: 'ses_a', modeId: 'plan' }]);
    expect(build.sent('session/set_mode')).toEqual([]);
  });

  it('a resume takes session/resume when advertised, session/load otherwise', async () => {
    const resumed = run({ resumeRef: 'ses_old' });
    const loaded = run({ resumeRef: 'ses_old' }, { ...SCRIPT, capabilities: { loadSession: true } });
    await new Promise((resolve) => setTimeout(resolve, 360));
    expect(resumed.sent('session/resume')).toEqual([{ sessionId: 'ses_old', cwd: 'W:/kt', mcpServers: [] }]);
    expect(resumed.sent('session/load')).toEqual([]);
    expect(loaded.sent('session/load')).toHaveLength(1);
  });

  it('the turn usage comes from the prompt reply, the cost from the reported session cost', async () => {
    const r = run();
    await ticks();
    r.agent.proc.say({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'usage_update', used: 9053, size: 200_000, cost: { amount: 0.12, currency: 'USD' } } } });
    r.agent.endTurn('Done.');
    await ticks();
    expect(r.events.find((e) => e.contextWindow !== undefined)).toMatchObject({ contextTokens: 9053, contextWindow: 200_000 });
    expect(r.events.find((e) => e.kind === 'result')).toMatchObject({ tokensIn: 4, tokensOut: 2, cacheReadTokens: 1, costUsd: 0.12 });
    const turn = r.events.find((e) => e.turnUsage !== undefined)!;
    expect(turn.turnUsage).toEqual({ input: 3, cacheRead: 1, cacheCreation: 0, output: 2 });
    expect(turn.contextTokens).toBeUndefined(); // a turn's sum is no context size
  });

  it('a turn with no message, no tool and no tokens is the provider refusing it, not a finished step (T-0061)', async () => {
    const r = run();
    await ticks();
    const prompt = JSON.parse(r.agent.proc.writes.find((w) => w.includes('"session/prompt"'))!) as { id: number };
    r.agent.proc.say({ jsonrpc: '2.0', id: prompt.id, result: { stopReason: 'end_turn' } });
    await ticks();
    expect(r.events.some((e) => e.kind === 'result')).toBe(false);
    expect(r.events.find((e) => e.kind === 'error')?.text).toContain('answered the prompt with nothing');
  });

  it('a quiet start (req-75) sends no prompt; the owner’s first word is the first turn', async () => {
    const r = run({ holdAtSpawn: true, resumeRef: 'ses_old' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(r.sent('session/resume')).toHaveLength(1);
    expect(r.sent('session/prompt')).toEqual([]);
    expect(r.events.at(-1)).toMatchObject({ kind: 'usage', turn: 'idle' });
    expect(await r.handle.steer('go on')).toBe('inject');
    await ticks();
    expect(r.sent('session/prompt')).toEqual([{ sessionId: 'ses_old', prompt: [{ type: 'text', text: 'go on' }] }]);
  });

  it('a permission names the tool and what it runs', async () => {
    const r = run();
    await ticks();
    r.agent.requestPermission();
    await ticks();
    expect(r.events.find((e) => e.waiting?.kind === 'permission')?.waiting?.text).toBe('shell echo hi');
  });

  it('a question form takes a choice by its label, the owner’s own words into its free-text field, and typed text while it stands', async () => {
    const r = run();
    await ticks();
    r.agent.askQuestion();
    await ticks();
    const id = r.events.find((e) => e.waiting?.kind === 'question')!.waiting!.requestId!;
    expect(await r.handle.answerQuestion!(id, { q0: 'green, please' })).toBe(true);
    expect(r.agent.replies.get('q-1')).toEqual({ action: 'accept', content: { q0_custom: 'green, please' } });
    r.agent.askQuestion();
    await ticks();
    expect(await r.handle.steer('red')).toBe('inject');
    expect(r.agent.replies.get('q-1')).toEqual({ action: 'accept', content: { q0: 'Red' } });
  });
});
