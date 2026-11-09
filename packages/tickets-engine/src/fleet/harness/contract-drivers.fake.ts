import { claudeCodeAdapter } from './claude-code';
import { ScriptedAcpAgent, type AcpAgentScript } from './contract-acp-agent.fake';
import type { NormalizedEvent, ProviderAdapter, ProviderStart, WorkerHandle } from './contract';
import { ContractProcess } from './contract-process.fake';
import { copilotAdapter } from './copilot';
import { FakeHarnessAdapter } from './fake-harness.fake';
import { kimiAdapter } from './kimi';
import { opencodeAcpAdapter } from './opencode-acp';

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
  /** req-183: the permission the adapter handed its harness, in the harness's own words (CLI flag, ACP mode). */
  permission(): string | null;
  /** req-182: the session the harness was asked to resume; null when none. */
  resumed(): string | null;
  /** req-182: the harness asks for an approval (absent: it has none the runner sees). */
  askPermission?(): Promise<void>;
  /** req-182: the harness's own question tool asks the owner (absent: its questions are the `QUESTION:` marker only). */
  askQuestion?(): Promise<void>;
  /** What the harness received as the answer to its request `id`. */
  reply(id: string): unknown;
}

export interface ContractDriver {
  readonly name: string;
  /** req-183: what a `read-only` start must reach the harness as. */
  readonly readOnly: string;
  /** req-182: what the harness receives when the owner allows once, and when the owner picks "Blue". */
  readonly answers: { readonly permission: unknown; readonly question: unknown } | null;
  start(over?: Partial<ProviderStart>): Promise<ContractSession>;
  dispose(): void;
}

function collect(over: Partial<ProviderStart> = {}): { start: ProviderStart; events: NormalizedEvent[] } {
  const events: NormalizedEvent[] = [];
  const start: ProviderStart = { cwd: 'W:/kt', instruction: 'Do the ticket.', model: null, permissionMode: 'accept-edits', resumeRef: null, ticketId: 'T-0001', onEvent: (e) => events.push(e), onSessionRef: () => undefined, ...over };
  return { start, events };
}

type Drive = Omit<ContractSession, 'handle' | 'events' | 'ended'>;

function session(handle: WorkerHandle, events: NormalizedEvent[], drive: Drive): ContractSession {
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

/** A session/load replays for 300 ms before the worker goes on. */
const replaySettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 320));

export const claudeCodeDriver: ContractDriver = {
  name: 'claude-code',
  readOnly: 'plan',
  answers: null,
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
      resumed: () => (args.includes('--resume') ? args[args.indexOf('--resume') + 1]! : null),
      reply: () => undefined,
    });
  },
  dispose: () => undefined,
};

const ELICITATION_ANSWERS = { permission: { outcome: { outcome: 'selected', optionId: 'once' } }, question: { action: 'accept', content: { q0: 'Blue' } } };

/** A driver over the one ACP adapter: the harness under test and its scripted agent. */
function acpDriver(name: string, opts: { readOnly: string; script: AcpAgentScript; adapter: (agent: ScriptedAcpAgent, args: (a: readonly string[]) => void) => ProviderAdapter; answers: ContractDriver['answers']; permission?: (args: readonly string[]) => string | null }): ContractDriver {
  return {
    name,
    readOnly: opts.readOnly,
    answers: opts.answers,
    async start(over) {
      const agent = new ScriptedAcpAgent(opts.script);
      let args: readonly string[] = [];
      const { start, events } = collect(over);
      const handle = opts.adapter(agent, (a) => (args = a)).spawn(start);
      await (start.resumeRef !== null ? replaySettle() : ticks());
      await ticks();
      return session(handle, events, {
        endTurn: async (text) => {
          agent.endTurn(text);
          await ticks();
        },
        settle: ticks,
        permission: () => agent.mode ?? opts.permission?.(args) ?? null,
        resumed: () => agent.resumed,
        askPermission: async () => {
          agent.requestPermission();
          await ticks();
        },
        askQuestion: async () => {
          agent.askQuestion();
          await ticks();
        },
        reply: (id) => agent.replies.get(id),
      });
    },
    dispose: () => undefined,
  };
}

const recording = (agent: ScriptedAcpAgent, keep: (a: readonly string[]) => void) => (_cmd: string, a: readonly string[]) => {
  keep(a);
  return agent.proc;
};

/** Kimi 2.5.2's advertised modes (`session/new` → `modes.availableModes`). */
const KIMI_MODES = { currentModeId: 'default', availableModes: ['default', 'plan', 'auto', 'yolo'].map((id) => ({ id, name: id })) };

export const kimiDriver = acpDriver('kimi', {
  readOnly: 'plan',
  script: { offer: { modes: KIMI_MODES }, capabilities: { loadSession: true }, questions: 'ask-user-question' },
  adapter: (agent, keep) => kimiAdapter(recording(agent, keep)),
  answers: { permission: { outcome: { outcome: 'selected', optionId: 'once' } }, question: { outcome: { outcome: 'selected', optionId: 'blue' } } },
});

/** opencode 2.0.32's offer: the modes as a config option of category `mode`. */
const OPENCODE_OFFER = {
  configOptions: [
    { id: 'model', category: 'model', type: 'select', currentValue: 'zai-coding-plan/glm-5.3', options: [{ value: 'zai-coding-plan/glm-5.3' }] },
    { id: 'mode', category: 'mode', type: 'select', currentValue: 'build', options: [{ value: 'build' }, { value: 'plan' }] },
  ],
};
const RESUMABLE = { loadSession: true, sessionCapabilities: { resume: {}, fork: {}, list: {} } };

export const opencodeDriver = acpDriver('opencode', {
  readOnly: 'plan',
  script: { offer: OPENCODE_OFFER, capabilities: RESUMABLE, questions: 'elicitation' },
  adapter: (agent, keep) => opencodeAcpAdapter(recording(agent, keep)),
  answers: ELICITATION_ANSWERS,
});

/** Copilot CLI as documented: no session modes; the tool permission rides the launch. */
export const copilotDriver = acpDriver('copilot', {
  readOnly: 'tools ask',
  script: { offer: {}, capabilities: RESUMABLE, questions: 'elicitation' },
  adapter: (agent, keep) => copilotAdapter(recording(agent, keep)),
  answers: ELICITATION_ANSWERS,
  permission: (args) => (args.includes('--allow-all-tools') ? 'allow-all-tools' : 'tools ask'),
});

export const fakeDriver: ContractDriver = {
  name: 'fake harness',
  readOnly: 'read-only',
  answers: null,
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
      resumed: () => start.resumeRef,
      reply: () => undefined,
    });
  },
  dispose: () => undefined,
};
