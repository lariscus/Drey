/**
 * The Mission Control LLM bridge (E5a, ADR-0088 later change): the one
 * provider seam the chat service composes (concept §4.7 — one prompt in,
 * structured answer out). It speaks two dialects, picked by the provider
 * kind Drey pushes (chat-model.ts): OpenAI-compatible (POST
 * {baseUrl}/chat/completions) and Anthropic Messages (POST
 * {baseUrl}/v1/messages), both `stream: true` SSE whose text deltas
 * accumulate the reply, parsed by core/chat-intents after the stream
 * completes; any other provider is refused with a named reason (D-1,
 * milestone 131). The system prompts are deps: the crew's prompt files
 * (`prompts/crew/`, req-279) — mission by default, the aggregator's for
 * the improvement loop's turns (E6). The bridge never touches the vault and
 * never throws: a missing model, an unsupported or unreachable provider each
 * resolve an outcome carrying a `failure` (provider, endpoint, reason) the
 * chat service reports as an error; an unreadable answer resolves an honest
 * say. Commands stay empty either way.
 */
import type { ChatBridge, ChatCommand, ChatModelFailure, ChatShapeReply, ChatStreamEvent } from '../contracts/chat';
import { parseEnvelope, type ChatEnvelope } from '../core/chat-intents';
import { causeOf, chatFailure, chatRequest, deltaOf, httpReason, resolveChatModel, type ChatDialect } from './chat-model';
import type { CrewPrompts } from './crew-prompts';

/** A shape turn may read the repository this many times before it must answer. */
const MAX_READ_ROUNDS = 3;

/** The config access the bridge needs — the engine's FileConfigStore fits. */
export interface ChatLlmConfig {
  get<T>(key: string): Promise<T | undefined>;
}

export interface ChatBridgeDeps {
  readonly config: ChatLlmConfig;
  /** The crew's prompt files (`loadCrewPrompts`, req-279): the mission, shape and flow texts. */
  readonly crew: CrewPrompts;
  /** The transport; the global fetch by default (the specs inject a fake). */
  readonly fetch?: typeof fetch;
  /** The system prompt of every turn; the crew's mission prompt by default (the aggregator passes its own). */
  readonly systemPrompt?: string;
}

/** The mission's answer — or its honest explanation of why there is none. */
interface TurnOutcome {
  readonly say: string;
  readonly thought: string | null;
  readonly commands: readonly ChatCommand[];
  readonly shape?: ChatShapeReply;
  readonly failure?: ChatModelFailure;
}

export function createChatBridge(deps: ChatBridgeDeps): ChatBridge {
  const transport = deps.fetch ?? fetch;
  const mission = deps.systemPrompt ?? deps.crew.mission;

  return {
    async runTurn(input) {
      const emit = (event: ChatStreamEvent): void => input.emit(event);
      /**
       * The honest fallback, never a throw: no commands, and a `failure`
       * the chat service turns into an error (the owner sees the card
       * with provider, endpoint and reason — never a mission message).
       * The stream carries no text for it.
       */
      const fail = (failure: ChatModelFailure): TurnOutcome => ({ say: failure.message, thought: null, commands: [], failure });

      const resolved = await resolveChatModel(deps.config);
      if (!resolved.ok) {
        return fail(resolved.failure);
      }
      const { spec } = resolved;
      const dialect: ChatDialect = spec.dialect;
      const refuse = (code: 'unreachable' | 'refused' | 'cancelled', reason: string): TurnOutcome =>
        fail(chatFailure(code, spec.provider, spec.baseUrl, spec.model, reason));

      // No timeout of its own (D-63, ADR-0014): a local model may think
      // for minutes, so the turn streams until the model ends or the
      // client cancels — its signal is the one thing that aborts the call.
      const controller = new AbortController();
      const onCancel = (): void => controller.abort();
      if (input.signal?.aborted === true) {
        controller.abort();
      }
      input.signal?.addEventListener('abort', onCancel, { once: true });
      try {
        const shape = input.shape;
        const sources: string[] = [];
        const system =
          input.flow !== undefined
            ? `${deps.crew.flow}\n\n## Flow\n\n${input.flow.context}`
            : shape === undefined
              ? `${mission}\n\n## Board digest\n\n${input.board}`
              : `${deps.crew.shape}\n\n## Ticket ${shape.ticket}\n\n${shape.ticketText}`;
        const messages: { role: string; content: string }[] = [
          { role: 'system', content: [system, input.named, input.reference].filter((part) => part !== undefined && part !== '').join('\n\n') },
          ...input.history.map((message) => ({
            role: message.role === 'owner' ? 'user' : 'assistant',
            content: message.text,
          })),
          { role: 'user', content: input.planDelta === undefined ? input.text : `${input.planDelta}\n\n${input.text}` },
        ];
        let envelope: ChatEnvelope | null = null;
        for (let round = 0; ; round++) {
          if (controller.signal.aborted) {
            return refuse('cancelled', 'the turn was cancelled.');
          }
          const request = chatRequest(spec, messages);
          const response = await transport(request.url, {
            method: 'POST',
            headers: request.headers,
            body: request.body,
            signal: controller.signal,
          });
          if (!response.ok) {
            return refuse('refused', httpReason(response.status, await response.text().catch(() => '')));
          }
          if (response.body === null) {
            return refuse('refused', 'the endpoint returned no stream.');
          }
          const reply = await readSse(
            response.body as unknown as AsyncIterable<Uint8Array>,
            dialect,
            // A shape reply is one JSON envelope around the plan: showing it
            // as it types would print the document escaped. The screen waits
            // (and shows what Paul reads) until the finished turn is read back.
            (delta) => (shape === undefined ? emit({ kind: 'text', text: delta }) : undefined),
            controller.signal,
          );
          if (controller.signal.aborted) {
            return refuse('cancelled', 'the turn was cancelled.');
          }
          envelope = parseEnvelope(reply.text, input.priorities);
          if (envelope === null) {
            // The model answered — only not in its envelope: an honest say,
            // not a connection failure (the card would send the owner to
            // the wrong place).
            const say = "The chat model's reply could not be read — it answered outside its envelope.";
            emit({ kind: 'text', text: say });
            return { say, thought: null, commands: [] };
          }
          // A shape turn may read the repository before it answers: the
          // files go back as the next user message, a bounded few rounds.
          if (shape === undefined || (envelope.read ?? []).length === 0 || round >= MAX_READ_ROUNDS) {
            break;
          }
          emit({ kind: 'thought', text: `Reading ${(envelope.read ?? []).join(', ')}. ` });
          const chunks: string[] = [];
          for (const path of envelope.read ?? []) {
            const file = await shape.readFile(path);
            if (file.ok) {
              if (!sources.includes(path)) {
                sources.push(path);
              }
              chunks.push(`### ${path}\n${file.text}`);
            } else {
              chunks.push(`### ${path}\nError: ${file.error}`);
            }
          }
          messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: `Files you asked for:\n\n${chunks.join('\n\n')}` });
        }
        const out: TurnOutcome = { say: envelope.say, thought: envelope.thought, commands: envelope.commands };
        if (shape === undefined) {
          return out;
        }
        const shaped: ChatShapeReply = { plan: envelope.plan ?? null, question: envelope.question ?? null, splitReason: envelope.splitReason ?? null, sources };
        return { ...out, shape: shaped };
      } catch (error) {
        if (controller.signal.aborted) {
          return refuse('cancelled', 'the turn was cancelled.');
        }
        return refuse('unreachable', `could not be reached — ${causeOf(error)}.`);
      } finally {
        input.signal?.removeEventListener('abort', onCancel);
      }
    },
  };
}

/**
 * Walks one SSE body: blank-line frames, `data:` lines, `[DONE]` ignored.
 * Every content delta reaches `onDelta` as it arrives (the UI's live
 * text); the full accumulated reply returns for the envelope parse. The
 * walk ends when the body ends or the client's signal aborts it — there
 * is no clock in here (D-63, ADR-0014).
 */
async function readSse(
  body: AsyncIterable<Uint8Array>,
  dialect: ChatDialect,
  onDelta: (delta: string) => void,
  signal: AbortSignal,
): Promise<{ readonly text: string }> {
  let text = '';
  let buffer = '';
  const decoder = new TextDecoder();
  for await (const chunk of body) {
    if (signal.aborted) {
      break;
    }
    buffer += decoder.decode(chunk, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data === '' || data === '[DONE]') {
        continue;
      }
      const delta = deltaOf(dialect, data);
      if (delta !== null && delta !== '') {
        text += delta;
        onDelta(delta);
      }
    }
  }
  return { text };
}
