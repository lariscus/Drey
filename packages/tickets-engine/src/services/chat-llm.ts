/**
 * The Mission Control LLM bridge (E5a, ADR-0088 later change): the one
 * provider seam the chat service composes (concept §4.7 — one prompt in,
 * structured answer out). It speaks two dialects, picked by the provider
 * kind Drey pushes (chat-model.ts): OpenAI-compatible (POST
 * {baseUrl}/chat/completions) and Anthropic Messages (POST
 * {baseUrl}/v1/messages), both `stream: true` SSE whose text deltas
 * accumulate the reply (chat-sse.ts), parsed by core/chat-intents after the
 * stream completes; any other provider is refused with a named reason (D-1,
 * milestone 131). The system prompts are deps: the crew's prompt files
 * (`prompts/crew/`, req-279) — mission by default, the aggregator's for
 * the improvement loop's turns (E6) — and, for Mission Control's own turns,
 * the prompt of its persona (Pia, req-269), read on every turn. The bridge
 * never touches the vault and never throws: one turn is a {@link ChatTurn}.
 */
import type { ChatBridge } from '../contracts/chat';
import type { CrewPrompts } from './crew-prompts';
import { ChatTurn } from './chat-turn';

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
  /**
   * req-269: Mission Control's persona prompt (`prompt.md` of the `kind:
   * mission` persona), read on every mission turn so an edit applies on the
   * next message; null = none. Asked only when `systemPrompt` is absent.
   */
  readonly missionPersona?: () => Promise<string | null>;
  /**
   * req-293: a model on the assistant's connection in place of `chat.model`,
   * asked on every turn; null = the assistant's own. On the mission bridge it
   * applies to Mission Control's own turns only (a shape or flow turn speaks
   * as another persona); a bridge with its own system prompt (Pia's 1:1)
   * applies it to every turn.
   */
  readonly model?: () => Promise<string | null>;
}

export function createChatBridge(deps: ChatBridgeDeps): ChatBridge {
  return {
    runTurn: (input) => new ChatTurn(deps, input).run(),
  };
}
