import { describe, expect, it } from 'vitest';
import type { SpawnFn } from '../ports/process-spawner';
import { ScriptedAcpAgent } from './contract-acp-agent.fake';
import type { NormalizedEvent, ProviderStart } from './contract';
import { COPILOT_NOT_READ_ONLY_NOTE, copilotAdapter, copilotArgs, copilotModeFor } from './copilot';

const ticks = async (n = 8): Promise<void> => {
  for (let i = 0; i < n; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

function run(over: Partial<ProviderStart> = {}, offer: Record<string, unknown> = {}) {
  const agent = new ScriptedAcpAgent({ offer, capabilities: { loadSession: true, sessionCapabilities: { resume: {} } }, questions: 'elicitation' });
  const events: NormalizedEvent[] = [];
  const spawned: Array<{ cmd: string; args: readonly string[]; env: Readonly<Record<string, string>> | undefined }> = [];
  const spawnFn: SpawnFn = (cmd, args, opts) => {
    spawned.push({ cmd, args, env: opts.env });
    return agent.proc;
  };
  const start: ProviderStart = { cwd: 'W:/kt', instruction: 'Do it.', model: null, permissionMode: 'accept-edits', resumeRef: null, ticketId: 'T-1', onEvent: (e) => events.push(e), onSessionRef: () => undefined, ...over };
  copilotAdapter(spawnFn).spawn(start);
  const sent = (method: string): number => agent.proc.writes.filter((w) => (JSON.parse(w) as { method?: string }).method === method).length;
  return { events, spawned, sent };
}

describe('Copilot CLI over ACP (req-182)', () => {
  it('launches `copilot --acp --stdio` with the model and the tool permission fixed at startup', () => {
    expect(copilotArgs({ model: 'claude-sonnet-4.5', permissionMode: 'accept-edits' })).toEqual(['--acp', '--stdio', '--model', 'claude-sonnet-4.5', '--allow-all-tools']);
    expect(copilotArgs({ model: null, permissionMode: 'bypass' })).toEqual(['--acp', '--stdio', '--allow-all-tools']);
    expect(copilotArgs({ model: '  ', permissionMode: 'read-only' })).toEqual(['--acp', '--stdio']);
  });

  it('sets no model over the session: the pin rode the launch', async () => {
    const r = run({ model: 'gpt-5' });
    await ticks();
    expect(r.spawned[0]).toMatchObject({ cmd: 'copilot', args: ['--acp', '--stdio', '--model', 'gpt-5', '--allow-all-tools'] });
    expect(r.sent('session/set_config_option')).toBe(0);
  });

  it('read-only: a plan mode when the session offers one; without it the stream says once that it is not enforced in the session', async () => {
    expect(copilotModeFor('read-only', ['agent', 'plan'])).toEqual({ modeId: 'plan', note: null });
    expect(copilotModeFor('accept-edits', ['plan'])).toEqual({ modeId: null, note: null });
    const r = run({ permissionMode: 'read-only' });
    await ticks();
    expect(r.events.filter((e) => e.text === COPILOT_NOT_READ_ONLY_NOTE)).toHaveLength(1);
    expect(r.sent('session/set_mode')).toBe(0);
  });

  it("a slot's account is its COPILOT_HOME, handed in through the environment", async () => {
    const r = run({ env: { COPILOT_HOME: 'C:/u/.copilot-work' } });
    await ticks();
    expect(r.spawned[0]!.env).toEqual({ COPILOT_HOME: 'C:/u/.copilot-work' });
  });
});
