import { vi } from 'vitest';
import { claudeCodeAdapter } from './claude-code';
import type { FetchFn, NormalizedEvent, ProviderAdapter, ProviderStart, WorkerHandle } from './contract';
import { ContractProcess } from './contract-process.fake';
import { FakeHarnessAdapter } from './fake-harness.fake';
import { kimiAdapter } from './kimi';
import { OPENCODE_API } from './opencode-api';
import { opencodeAdapter } from './opencode';

/** One worker under the contract suite, and how to drive it. */
export interface ContractSession {
  readonly handle: WorkerHandle;
  readonly events: NormalizedEvent[];
  /** The worker ends its running turn with this final message. */
  endTurn(text: string): Promise<void>;
  /** Lets the adapter's pending work run (microtasks, its timers). */
  settle(): Promise<void>;
  /** The worker's exit has resolved. */
  ended(): boolean;
  /** req-183: the permission the adapter handed its harness, in the harness's own words (CLI flag, agent, ACP mode). */
  permission(): string | null;
}

export interface ContractDriver {
  readonly name: string;
  /** req-183: what a `read-only` start must reach the harness as. */
  readonly readOnly: string;
  start(over?: Partial<ProviderStart>): Promise<ContractSession>;
  dispose(): void;
}

function collect(over: Partial<ProviderStart> = {}): { start: ProviderStart; events: NormalizedEvent[] } {
  const events: NormalizedEvent[] = [];
  const start: ProviderStart = { cwd: 'W:/kt', instruction: 'Do the ticket.', model: null, permissionMode: 'accept-edits', resumeRef: null, ticketId: 'T-0001', onEvent: (e) => events.push(e), onSessionRef: () => undefined, ...over };
  return { start, events };
}

function session(handle: WorkerHandle, events: NormalizedEvent[], drive: Pick<ContractSession, 'endTurn' | 'settle' | 'permission'>): ContractSession {
  let done = false;
  void handle.exited.then(() => {
    done = true;
  });
  return { handle, events, ...drive, ended: () => done };
}

const ticks = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

export const claudeCodeDriver: ContractDriver = {
  name: 'claude-code',
  readOnly: 'plan',
  async start(over) {
    const proc = new ContractProcess();
    const { start, events } = collect(over);
    let args: readonly string[] = [];
    const handle = claudeCodeAdapter((_cmd, a) => {
      args = a;
      return proc;
    }).spawn(start);
    proc.say({ type: 'system', subtype: 'init', session_id: 'ses_c' });
    return session(handle, events, {
      endTurn: async (text) => {
        proc.say({ type: 'result', subtype: 'success', result: text, usage: { input_tokens: 1, output_tokens: 1 } });
        await ticks();
      },
      settle: ticks,
      permission: () => args[args.indexOf('--permission-mode') + 1] ?? null,
    });
  },
  dispose: () => undefined,
};

/** Kimi 2.5.2's advertised modes (`session/new` → `modes.availableModes`). */
const KIMI_MODES = { currentModeId: 'default', availableModes: ['default', 'plan', 'auto', 'yolo'].map((id) => ({ id, name: id })) };

/** A scripted ACP agent: the setup calls answer at once, a prompt waits for `endTurn` or a cancel. */
function acpAgent(): { proc: ContractProcess; endTurn: (text: string) => void; mode: () => string | null } {
  let prompt: number | string | null = null;
  let mode: string | null = null;
  const reply = (proc: ContractProcess, id: number | string, result: unknown): void => proc.say({ jsonrpc: '2.0', id, result });
  const proc = new ContractProcess((text, self) => {
    for (const line of text.split('\n').filter((l) => l.trim() !== '')) {
      const msg = JSON.parse(line) as { id?: number | string; method?: string; params?: { modeId?: string } };
      if (msg.method === 'session/set_mode') {
        mode = msg.params?.modeId ?? null;
      }
      if (msg.method === 'session/prompt') {
        prompt = msg.id ?? null;
      } else if (msg.method === 'session/cancel' && prompt !== null) {
        const id = prompt;
        prompt = null;
        reply(self, id, { stopReason: 'cancelled' });
      } else if (msg.id !== undefined && msg.method !== undefined) {
        reply(self, msg.id, msg.method === 'session/new' ? { sessionId: 'ses_k', modes: KIMI_MODES } : {});
      }
    }
  });
  return {
    proc,
    endTurn: (text) => {
      proc.say({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });
      if (prompt !== null) {
        const id = prompt;
        prompt = null;
        reply(proc, id, { stopReason: 'end_turn' });
      }
    },
    mode: () => mode,
  };
}

export const kimiDriver: ContractDriver = {
  name: 'kimi',
  readOnly: 'plan',
  async start(over) {
    const agent = acpAgent();
    const { start, events } = collect(over);
    const handle = kimiAdapter(agent.proc.spawnFn()).spawn(start);
    await ticks();
    return session(handle, events, {
      endTurn: async (text) => {
        agent.endTurn(text);
        await ticks();
      },
      settle: ticks,
      permission: agent.mode,
    });
  },
  dispose: () => undefined,
};

/** A scripted OpenCode server: the message list grows with each prompt and each ended turn. */
function opencodeServer(): { fetch: FetchFn; endTurn: (text: string) => void; agent: () => string | null } {
  const list: unknown[] = []; // newest first, as the API lists it
  let n = 0;
  let agent: string | null = null;
  const json = (body: unknown): Response => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
  const fetch: FetchFn = async (url, init) => {
    if (url.endsWith(OPENCODE_API.createSession)) {
      return json({ data: { id: 'ses_oc' } });
    }
    if (url.endsWith(OPENCODE_API.prompt('ses_oc'))) {
      agent = (JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { agent?: string }).agent ?? 'default';
      list.unshift({ id: `u${++n}`, type: 'user', time: { created: Date.now() } });
      return json({ data: {} });
    }
    if (url.endsWith(OPENCODE_API.messages('ses_oc'))) {
      return json({ data: list });
    }
    if (url.endsWith(OPENCODE_API.session('ses_oc'))) {
      return json({ data: { tokens: { input: 1, output: 1 }, cost: 0 } });
    }
    if (url.endsWith(OPENCODE_API.permissions('ses_oc')) || url.endsWith(OPENCODE_API.forms('ses_oc'))) {
      return json({ data: [] });
    }
    return init?.method === 'POST' || url.endsWith(OPENCODE_API.info) ? json({}) : json({ data: [] });
  };
  const endTurn = (text: string): void => {
    const t = Date.now();
    list.unshift({ id: `a${++n}`, type: 'assistant', time: { created: t, completed: t }, content: [{ type: 'text', text }] });
    list.unshift({ id: `i${n}`, type: 'idle', time: { created: t }, outcome: 'succeeded' });
  };
  return { fetch, endTurn, agent: () => agent };
}

export const opencodeDriver: ContractDriver = {
  name: 'opencode',
  readOnly: 'plan',
  async start(over) {
    vi.useFakeTimers();
    const proc = new ContractProcess();
    const server = opencodeServer();
    const { start, events } = collect(over);
    const handle = opencodeAdapter(proc.spawnFn(), server.fetch, async () => 47000, () => new Date(Date.now())).spawn(start);
    await vi.advanceTimersByTimeAsync(10);
    proc.say('server password sekrit');
    await vi.advanceTimersByTimeAsync(1_000);
    const settle = async (): Promise<void> => {
      await vi.advanceTimersByTimeAsync(2_500);
    };
    return session(handle, events, {
      endTurn: async (text) => {
        await vi.advanceTimersByTimeAsync(5);
        server.endTurn(text);
        await settle();
      },
      settle,
      permission: server.agent,
    });
  },
  dispose: () => {
    vi.useRealTimers();
  },
};

export const fakeDriver: ContractDriver = {
  name: 'fake harness',
  readOnly: 'read-only',
  async start(over) {
    const adapter: ProviderAdapter & { workers: FakeHarnessAdapter['workers'] } = new FakeHarnessAdapter();
    const { start, events } = collect(over);
    const handle = adapter.spawn(start);
    return session(handle, events, {
      endTurn: async (text) => {
        adapter.workers[0]!.finishTurn(text);
        await ticks();
      },
      settle: ticks,
      permission: () => start.permissionMode,
    });
  },
  dispose: () => undefined,
};
