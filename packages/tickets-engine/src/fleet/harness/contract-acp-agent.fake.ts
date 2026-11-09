import { ContractProcess } from './contract-process.fake';

/** How a scripted ACP agent behaves: what it offers and how it asks a question. */
export interface AcpAgentScript {
  /** `session/new`'s extra result fields (Kimi's `modes`, opencode's `configOptions`). */
  readonly offer: Readonly<Record<string, unknown>>;
  /** `initialize`'s `agentCapabilities` (opencode and Copilot advertise `sessionCapabilities.resume`). */
  readonly capabilities: Readonly<Record<string, unknown>>;
  /** Kimi asks through a disguised permission request (AskUserQuestion); opencode and Copilot through `elicitation/create`. */
  readonly questions: 'ask-user-question' | 'elicitation';
}

type Msg = { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown };

/** The permission options an ACP agent offers (opencode 2.0.32's ids; Kimi's differ, matched by kind). */
export const PERMISSION_OPTIONS = [
  { optionId: 'once', kind: 'allow_once', name: 'Allow once' },
  { optionId: 'always', kind: 'allow_always', name: 'Always allow' },
  { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
];

/**
 * A scripted ACP agent for the contract suite (req-182): the setup calls
 * answer at once; a prompt waits for `endTurn` or a cancel; it can hold a
 * permission request or a question open and records what the client
 * answered, which session mode it was put in, and which session it was
 * asked to resume.
 */
export class ScriptedAcpAgent {
  readonly proc: ContractProcess;
  readonly replies = new Map<string, unknown>();
  mode: string | null = null;
  resumed: string | null = null;
  private prompt: number | string | null = null;

  constructor(private readonly script: AcpAgentScript) {
    this.proc = new ContractProcess((text) => text.split('\n').filter((l) => l.trim() !== '').forEach((line) => this.onLine(JSON.parse(line) as Msg)));
  }

  /** The agent ends its running turn with this final message. */
  endTurn(text: string): void {
    this.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
    this.answerPrompt('end_turn');
  }

  /** A tool call that needs the owner's approval. */
  requestPermission(): void {
    this.update({ sessionUpdate: 'tool_call', toolCallId: 't-perm', title: 'shell', kind: 'execute', status: 'pending', rawInput: {} });
    this.say({ id: 'perm-1', method: 'session/request_permission', params: { sessionId: 'ses_a', toolCall: { toolCallId: 't-perm', name: 'shell', title: 'echo hi', kind: 'execute' }, options: PERMISSION_OPTIONS } });
  }

  /** The agent's own question tool asks the owner to pick a colour. */
  askQuestion(): void {
    if (this.script.questions === 'ask-user-question') {
      const options = [
        { optionId: 'red', kind: 'allow_once', name: 'Red' },
        { optionId: 'blue', kind: 'allow_once', name: 'Blue' },
        { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
      ];
      this.say({ id: 'q-1', method: 'session/request_permission', params: { sessionId: 'ses_a', toolCall: { toolCallId: 't-q', title: 'AskUserQuestion', content: [{ content: { text: 'Which colour?' } }] }, options } });
      return;
    }
    const q0 = { type: 'string', title: 'Colour', description: 'Which colour?', oneOf: [{ const: 'Red', title: 'Red' }, { const: 'Blue', title: 'Blue' }] };
    this.say({ id: 'q-1', method: 'elicitation/create', params: { mode: 'form', sessionId: 'ses_a', toolCallId: 't-q', message: 'Questions', requestedSchema: { type: 'object', properties: { q0, q0_custom: { type: 'string', title: 'Colour (other)' } }, required: [] } } });
  }

  private onLine(msg: Msg): void {
    if (msg.method === undefined && msg.id !== undefined) {
      this.replies.set(String(msg.id), msg.result);
      return;
    }
    if (msg.method === 'session/set_mode') {
      this.mode = typeof msg.params?.['modeId'] === 'string' ? msg.params['modeId'] : null;
    }
    if (msg.method === 'session/resume' || msg.method === 'session/load') {
      this.resumed = typeof msg.params?.['sessionId'] === 'string' ? msg.params['sessionId'] : null;
    }
    if (msg.method === 'session/prompt') {
      this.prompt = msg.id ?? null;
    } else if (msg.method === 'session/cancel') {
      this.answerPrompt('cancelled');
    } else if (msg.id !== undefined && msg.method !== undefined) {
      this.say({ id: msg.id, result: this.resultOf(msg.method) });
    }
  }

  private resultOf(method: string): Record<string, unknown> {
    if (method === 'initialize') {
      return { protocolVersion: 1, agentCapabilities: this.script.capabilities };
    }
    return method === 'session/new' ? { sessionId: 'ses_a', ...this.script.offer } : method.startsWith('session/') && method !== 'session/set_mode' ? { ...this.script.offer } : {};
  }

  private answerPrompt(stopReason: string): void {
    if (this.prompt !== null) {
      const id = this.prompt;
      this.prompt = null;
      this.say({ id, result: { stopReason, usage: { inputTokens: 3, outputTokens: 2, cachedReadTokens: 1 } } });
    }
  }

  private update(update: Record<string, unknown>): void {
    this.say({ method: 'session/update', params: { sessionId: 'ses_a', update } });
  }

  private say(body: Record<string, unknown>): void {
    this.proc.say({ jsonrpc: '2.0', ...body });
  }
}
