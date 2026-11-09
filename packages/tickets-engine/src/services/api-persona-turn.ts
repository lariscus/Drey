import type { ChatBridge } from '../contracts/chat';
import type { TurnOutcome } from './persona-turn-watcher';

/**
 * The envelope rule an `api` persona's 1:1 brief ends with: the chat
 * bridge reads one JSON object per reply (`services/chat-llm.ts`). In
 * `specs/classifier-spec.md` beside the 1:1 brief.
 */
export const API_ENVELOPE_RULE =
  '## Reply format\n\nReply with exactly one JSON object and nothing else: {"say": "<your answer as Markdown, proposal blocks included>"}.';

/** What the bridge is told instead of a board digest: a 1:1 embeds no board (R2). */
const NO_BOARD = 'Not embedded in a 1:1.';

/** One turn of an `api` persona's 1:1. */
export interface ApiTurnInput {
  readonly system: string;
  readonly history: readonly { readonly role: 'owner' | 'persona'; readonly text: string }[];
  readonly text: string;
}

export type ApiTurnRunner = (input: ApiTurnInput) => Promise<TurnOutcome>;

/**
 * A persona with `worker: api` has no runner session (ADR-0093): each line
 * is one call of the chat bridge — the Drey assistant's model settings —
 * with the persona's 1:1 brief as the system prompt and the conversation
 * as the history. `make` builds a bridge over a system prompt.
 */
export function bridgeTurnRunner(make: (systemPrompt: string) => ChatBridge): ApiTurnRunner {
  return async (input) => {
    const bridge = make(`${input.system}\n\n${API_ENVELOPE_RULE}`);
    const reply = await bridge.runTurn({
      text: input.text,
      history: input.history.map((m) => ({ role: m.role === 'owner' ? 'owner' : 'mission', text: m.text })),
      board: NO_BOARD,
      emit: () => undefined,
    });
    if (reply.failure !== undefined) {
      return { ok: false, error: reply.failure.message };
    }
    return reply.say.trim() === '' ? { ok: false, error: 'the model answered nothing' } : { ok: true, text: reply.say };
  };
}
