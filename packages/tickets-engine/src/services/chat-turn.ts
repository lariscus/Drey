/**
 * One turn of the Mission Control bridge (E5a, D-1, D-63): the system
 * message ({@link chatSystemOf}), the history and the owner's line go out as
 * one streamed request; the reply's envelope is parsed after the stream
 * ends. A shape turn may read the ticket's repository a bounded few rounds
 * before it answers (through the envelope's `read`); a mission turn may call
 * its read-only tools first (req-315) — each round repeats until the model
 * answers without a tool call, and the answer is the one JSON envelope.
 * Never throws: a missing model, an unsupported or unreachable provider, a
 * refusal or the client's cancel each resolve an outcome carrying a
 * `failure`; an unreadable answer resolves an honest say.
 */
import type { ChatMessage, ChatToolCall } from '../../../../shared/llm';
import type { ChatBridge, ChatCommand, ChatModelFailure, ChatShapeReply, ChatStreamEvent } from '../contracts/chat';
import { parseEnvelope, type ChatEnvelope } from '../core/chat/chat-intents';
import type { ChatBridgeDeps } from './chat-llm';
import { causeOf, chatFailure, chatRequest, httpReason, resolveChatModel, type ChatModelSpec } from './chat-model';
import { readSse } from './chat-sse';
import { chatSystemOf } from './chat-system-prompt';

/** A shape turn may read the repository this many times before it must answer. */
const MAX_READ_ROUNDS = 3;
/** Tool rounds of a mission turn before it must answer from what it read (req-315). */
const MAX_TOOL_ROUNDS = 6;

const CANCELLED = 'the turn was cancelled.';

export type ChatTurnInput = Parameters<ChatBridge['runTurn']>[0];

/** The mission's answer — or its honest explanation of why there is none. */
export interface ChatTurnOutcome {
  readonly say: string;
  readonly thought: string | null;
  readonly commands: readonly ChatCommand[];
  readonly shape?: ChatShapeReply;
  readonly failure?: ChatModelFailure;
}

/** One streamed round's reply: the text and the tool calls the model made. */
interface RoundReply {
  readonly text: string;
  readonly toolCalls: readonly ChatToolCall[];
}

/** One exchange's result: the turn's end, or the raw reply of the round. */
type Exchange = { readonly outcome: ChatTurnOutcome } | { readonly reply: RoundReply };

/**
 * The honest fallback, never a throw: no commands, and a `failure` the chat
 * service turns into an error (the owner sees the card with provider,
 * endpoint and reason — never a mission message). The stream carries no text for it.
 */
function failed(failure: ChatModelFailure): ChatTurnOutcome {
  return { say: failure.message, thought: null, commands: [], failure };
}

export class ChatTurn {
  private readonly controller = new AbortController();
  private readonly sources: string[] = [];

  constructor(
    private readonly deps: ChatBridgeDeps,
    private readonly input: ChatTurnInput,
  ) {}

  async run(): Promise<ChatTurnOutcome> {
    const resolved = await resolveChatModel(this.deps.config, await this.modelOverride());
    if (!resolved.ok) {
      return failed(resolved.failure);
    }
    // No timeout of its own (D-63, ADR-0014): a local model may think for
    // minutes, so the turn streams until the model ends or the client
    // cancels — its signal is the one thing that aborts the call.
    const onCancel = (): void => this.controller.abort();
    if (this.input.signal?.aborted === true) {
      this.controller.abort();
    }
    this.input.signal?.addEventListener('abort', onCancel, { once: true });
    try {
      return await this.converse(resolved.spec);
    } catch (error) {
      return this.aborted() ? this.refuse(resolved.spec, 'cancelled', CANCELLED) : this.refuse(resolved.spec, 'unreachable', `could not be reached — ${causeOf(error)}.`);
    } finally {
      this.input.signal?.removeEventListener('abort', onCancel);
    }
  }

  /** req-293: the pinned model of this turn — Mission Control's own turns (or every turn of a bridge with its own prompt); null = `chat.model`. */
  private async modelOverride(): Promise<string | null> {
    const ownTurn = this.deps.systemPrompt !== undefined || this.input.shape === undefined;
    if (this.deps.model === undefined || !ownTurn) {
      return null;
    }
    return this.deps.model().catch(() => null);
  }

  private aborted(): boolean {
    return this.controller.signal.aborted;
  }

  private refuse(spec: ChatModelSpec, code: 'unreachable' | 'refused' | 'cancelled', reason: string): ChatTurnOutcome {
    return failed(chatFailure(code, spec.provider, spec.baseUrl, spec.model, reason));
  }

  private emit(event: ChatStreamEvent): void {
    this.input.emit(event);
  }

  private async converse(spec: ChatModelSpec): Promise<ChatTurnOutcome> {
    const messages = await this.openingMessages();
    for (let round = 0; ; round++) {
      const exchange = await this.exchange(spec, messages);
      if ('outcome' in exchange) {
        return exchange.outcome;
      }
      const { text, toolCalls } = exchange.reply;
      const tools = this.input.shape === undefined ? this.input.tools : undefined;
      if (tools !== undefined && toolCalls.length > 0) {
        if (this.aborted()) {
          return this.refuse(spec, 'cancelled', CANCELLED);
        }
        if (round >= MAX_TOOL_ROUNDS) {
          return this.outOfRounds();
        }
        messages.push({ role: 'assistant', content: text === '' ? null : text, tool_calls: [...toolCalls] });
        messages.push(...(await this.toolResults(tools, toolCalls)));
        continue;
      }
      const outcome = await this.envelopeOutcome(text, round, messages);
      if (outcome !== null) {
        return outcome;
      }
    }
  }

  /**
   * The round's reply as the envelope — or null when a shape turn asked for
   * repository reads (they went back as the next user message, a bounded few
   * rounds) and the turn continues.
   */
  private async envelopeOutcome(text: string, round: number, messages: ChatMessage[]): Promise<ChatTurnOutcome | null> {
    const envelope = parseEnvelope(text, this.input.priorities);
    if (envelope === null) {
      // The model answered — only not in its envelope: an honest say, not a
      // connection failure (the card would send the owner to the wrong place).
      const say = "The chat model's reply could not be read — it answered outside its envelope.";
      this.emit({ kind: 'text', text: say });
      return { say, thought: null, commands: [] };
    }
    const reads = envelope.read ?? [];
    if (this.input.shape !== undefined && reads.length > 0 && round < MAX_READ_ROUNDS) {
      // A shape turn may read the repository before it answers: the files
      // go back as the next user message, a bounded few rounds.
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: await this.readFiles(reads) });
      return null;
    }
    return this.finish(envelope);
  }

  /** The round cap's honest say: what she read stands in the turn's thoughts, the answer asks to continue. */
  private outOfRounds(): ChatTurnOutcome {
    const say = 'I ran out of rounds before I could answer — ask again and I will pick up what I read.';
    this.emit({ kind: 'text', text: say });
    return { say, thought: null, commands: [] };
  }

  /** Executes one round's tool calls through the seam — a refusal is the tool's `Error:` text the model acts on. */
  private async toolResults(tools: NonNullable<ChatTurnInput['tools']>, calls: readonly ChatToolCall[]): Promise<readonly ChatMessage[]> {
    const results: ChatMessage[] = [];
    for (const call of calls) {
      this.emit({ kind: 'thought', text: `${toolLabel(call)} ` });
      let args: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(call.function.arguments || '{}');
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        // Empty or broken arguments: the tool answers with its own refusal.
      }
      const result = await tools.call(call.function.name, args).catch((error: unknown) => `Error: ${error instanceof Error ? error.message : String(error)}`);
      results.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
    return results;
  }

  /** The system message, the history and the owner's line (with the plan delta in front of it when there is one). */
  private async openingMessages(): Promise<ChatMessage[]> {
    const { input } = this;
    const system = chatSystemOf(
      { mission: this.deps.systemPrompt ?? this.deps.crew.mission, shape: this.deps.crew.shape },
      {
        board: input.board,
        ...(input.shape === undefined ? {} : { shape: input.shape }),
        ...(input.voice === undefined ? {} : { voice: input.voice }),
        ...(input.missionTicket === undefined ? {} : { ticket: input.missionTicket }),
        persona: await this.missionPersona(),
      },
    );
    return [
      { role: 'system', content: [system, input.named, input.reference].filter((part) => part !== undefined && part !== '').join('\n\n') },
      ...input.history.map((message) => ({ role: message.role === 'owner' ? ('user' as const) : ('assistant' as const), content: message.text })),
      { role: 'user', content: input.planDelta === undefined ? input.text : `${input.planDelta}\n\n${input.text}` },
    ];
  }

  /**
   * req-269: Mission Control's persona prompt — a mission turn of the mission
   * bridge only (a bridge with its own
   * system prompt — the aggregator, a 1:1 — is not Mission Control). A shape
   * turn speaks as its own assigned persona (req-272, `input.voice`).
   */
  private async missionPersona(): Promise<string | null> {
    if (this.input.shape !== undefined || this.deps.systemPrompt !== undefined || this.deps.missionPersona === undefined) {
      return null;
    }
    return this.deps.missionPersona().catch(() => null);
  }

  private async exchange(spec: ChatModelSpec, messages: readonly ChatMessage[]): Promise<Exchange> {
    if (this.aborted()) {
      return { outcome: this.refuse(spec, 'cancelled', CANCELLED) };
    }
    const request = chatRequest(spec, messages, this.input.shape === undefined ? this.input.tools?.specs : undefined);
    const response = await (this.deps.fetch ?? fetch)(request.url, { method: 'POST', headers: request.headers, body: request.body, signal: this.controller.signal });
    if (!response.ok) {
      return { outcome: this.refuse(spec, 'refused', httpReason(response.status, await response.text().catch(() => ''))) };
    }
    if (response.body === null) {
      return { outcome: this.refuse(spec, 'refused', 'the endpoint returned no stream.') };
    }
    // A shape reply is one JSON envelope around the plan: showing it as it
    // types would print the document escaped. The screen waits (and shows
    // what Paul reads) until the finished turn is read back.
    const live = this.input.shape === undefined;
    const reply = await readSse(response.body as unknown as AsyncIterable<Uint8Array>, spec.dialect, (delta) => (live ? this.emit({ kind: 'text', text: delta }) : undefined), this.controller.signal);
    if (this.aborted()) {
      return { outcome: this.refuse(spec, 'cancelled', CANCELLED) };
    }
    return { reply: { text: reply.text, toolCalls: reply.toolCalls } };
  }

  /** The files a shape turn asked for, as the next user message; each read file joins the turn's sources. */
  private async readFiles(paths: readonly string[]): Promise<string> {
    const shape = this.input.shape!;
    this.emit({ kind: 'thought', text: `Reading ${paths.join(', ')}. ` });
    const chunks: string[] = [];
    for (const path of paths) {
      const file = await shape.readFile(path);
      if (file.ok) {
        if (!this.sources.includes(path)) {
          this.sources.push(path);
        }
        chunks.push(`### ${path}\n${file.text}`);
      } else {
        chunks.push(`### ${path}\nError: ${file.error}`);
      }
    }
    return `Files you asked for:\n\n${chunks.join('\n\n')}`;
  }

  private finish(envelope: ChatEnvelope): ChatTurnOutcome {
    const out: ChatTurnOutcome = { say: envelope.say, thought: envelope.thought, commands: envelope.commands };
    if (this.input.shape === undefined) {
      return out;
    }
    const shaped: ChatShapeReply = { plan: envelope.plan ?? null, question: envelope.question ?? null, splitReason: envelope.splitReason ?? null, sources: [...this.sources] };
    return { ...out, shape: shaped };
  }
}

/** The thought line a tool call shows while it runs: the name and its first string argument, clipped. */
function toolLabel(call: ChatToolCall): string {
  let first = '';
  try {
    const parsed: unknown = JSON.parse(call.function.arguments || '{}');
    if (typeof parsed === 'object' && parsed !== null) {
      first = Object.values(parsed as Record<string, unknown>).find((value): value is string => typeof value === 'string' && value !== '') ?? '';
    }
  } catch {
    first = '';
  }
  const tail = first === '' ? '' : ` ${first.slice(0, 80)}`;
  return `${call.function.name}${tail} …`;
}
