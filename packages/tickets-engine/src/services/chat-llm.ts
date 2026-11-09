/**
 * The Mission Control LLM bridge (E5a, ADR-0088 later change): the one
 * provider seam the chat service composes (concept §4.7 — one prompt in,
 * structured answer out). It speaks two dialects, picked by the provider
 * kind Drey pushes (chat-model.ts): OpenAI-compatible (POST
 * {baseUrl}/chat/completions) and Anthropic Messages (POST
 * {baseUrl}/v1/messages), both `stream: true` SSE whose text deltas
 * accumulate the reply, parsed by core/chat-intents after the stream
 * completes; any other provider is refused with a named reason (D-1,
 * milestone 131). The system prompt is a
 * dep (the mission prompt by default, AGGREGATOR_SYSTEM_PROMPT for the
 * improvement loop's turns — E6). The bridge never touches the vault and
 * never throws: a missing model, an unsupported or unreachable provider each
 * resolve an outcome carrying a `failure` (provider, endpoint, reason) the
 * chat service reports as an error; an unreadable answer resolves an honest
 * say. Commands stay empty either way.
 */
import type { ChatBridge, ChatCommand, ChatModelFailure, ChatShapeReply, ChatStreamEvent } from '../contracts/chat';
import { parseEnvelope, type ChatEnvelope } from '../core/chat-intents';
import { causeOf, chatFailure, chatRequest, deltaOf, httpReason, resolveChatModel, type ChatDialect } from './chat-model';
import { SHAPE_SYSTEM_PROMPT } from './shape-system-prompt';

/** A shape turn may read the repository this many times before it must answer. */
const MAX_READ_ROUNDS = 3;

/**
 * The system prompt of every mission turn (English, per the owner
 * decision 2026-11-02). The run embeds the board digest below it; the
 * STRICT output contract is what makes the accumulated reply parseable
 * by core/chat-intents.
 */
export const MISSION_SYSTEM_PROMPT = `You are Mission Control, the owner's single operational contact for the tickets board.

You serve exactly seven intents:
- steer — the owner wants a ticket moved or reprioritised: answer with a short say plus a transition and/or setPriority command.
- create — the owner captures an idea or an inbox item: answer with a createTicket command for the phase the owner names (inbox when none is named).
- promote — the owner accepts a scout ticket's report and wants the ticket built: answer with a promote command naming that ticket; it turns into a ship ticket and enters the normal pipeline (plan, worktree, gate) on its next run.
- chain — the owner wants a ticket's gate chain changed (insert a gate, skip a gate, set a notify rule, or return the ticket to the standard flow): answer with a setChain command carrying the ticket's whole new delta, never a partial edit.
- blocked — the owner wants a ticket to wait for others (or stop waiting): answer with a setBlockedBy command carrying the ticket's whole blocker list, never a partial edit.
- session — the owner wants a persona to work on something outside the board (look into a folder, try something, answer a question in a repository): answer with a startSession command naming the persona, the folder and the first line; only personas and folders from the "Sessions you may propose" block.
- report — the owner asks about the board or about a ticket: answer from the board digest and the tickets named below, and propose no commands. A ticket the digest does not list is not missing: closed tickets and tickets beyond the digest's size are left out of it — when the owner names one, its file is attached under "Tickets the owner named"; say "I cannot find it" only when that block says so.

STRICT output contract: your entire reply is exactly one JSON object and nothing outside it — no prose before or after, no markdown fences:
{"say": string, "thought": string, "commands": []}
- "say" is the sentence you speak to the owner.
- "thought" is your brief reasoning.
- "commands" holds zero or more typed commands, each safe to propose: the chat NEVER writes without the owner's explicit confirmation — every command renders as a proposal card the owner confirms or dismisses.

Rules:
- Never invent ticket ids: use only ids that appear in the board digest or in the named tickets below.
- Never invent priority words: the board's priorities are configured per vault — the digest's "priorities (weight order)" line is the whole vocabulary, and a setPriority/createTicket command picks from it.
- description fields are written in the owner's language.
- Propose only what the board itself does: createTicket, transition, setPriority, promote, setChain, setBlockedBy, startSession.
- setChain replaces the ticket's whole chain delta with the given list — one canonical entry per item: "insert <phase>[(<persona>[, notify] | notify)] after|before <anchor>" adds a gate at the anchor phase (a phase the standard flow already contains may be revisited this way, at most once), "skip <phase>" bypasses a gate for this ticket, "notify <phase>" lands a card in Needs you when the gate completes. An empty list returns the ticket to the standard flow. Phase ids are the digest's column ids. Example: {"kind":"setChain","id":"T-0086","chain":["insert security(ralf, notify) after review","skip verify"]}.
- setBlockedBy replaces the ticket's whole blocked-by list with the given ticket ids (digest ids only) — the ticket waits until every one reaches the terminal column. An empty list clears the blockers. Example: {"kind":"setBlockedBy","id":"T-0002","blockedBy":["T-0001","T-0003"]}.
- startSession opens a free session: the persona works in the folder (an absolute path from the block — the tickets repository is one), with no ticket, until the owner stops talking to it. "poolClass" is "A", "B", "C" or null (null = the persona's model decides); "brief" is the first line the persona gets, in the owner's words. Example: {"kind":"startSession","persona":"ben","directory":"E:/projects/drey","poolClass":null,"brief":"Find out why the build is slow and tell me."}.`;

export { SHAPE_SYSTEM_PROMPT };

/**
 * The system prompt of a flow draft (E10-5, concept v2 §5.7). Paul reads
 * one flow and proposes the whole chain delta; the envelope is the
 * mission envelope with a single setChain command, which the desk
 * validates and shows as a draft — nothing is written by the draft.
 */
export const FLOW_SYSTEM_PROMPT = `You are Paul, the planner of the tickets crew. The owner asks you to draft the flow (the chain of gates) of one ticket or one part of a plan. You only propose; the owner sees your draft, edits it and saves it or drops it.

STRICT output contract: your entire reply is exactly one JSON object and nothing outside it — no prose before or after, no markdown fences:
{"say": string, "thought": string, "commands": [{"kind": "setChain", "id": string, "chain": [string]}]}
- "say" is one or two sentences: why the flow looks like this. It is shown to the owner next to the draft.
- The single command's "id" is the ticket id given below; "chain" is the WHOLE delta against the standard flow, one canonical entry per item. An empty list means the standard flow stays as it is.

The grammar, one entry per item:
- "insert <phase>[(<persona>[, notify] | notify)] after|before <anchor>" adds a gate (a phase of the standard flow may be added once more, as a revisit). Example: "insert security(ralf, notify) after review".
- "skip <phase>" strikes a standard gate for this flow.
- "notify <phase>" tells the owner when a standard gate is done.
- "move <phase> after|before <anchor>" runs a standard gate somewhere else.
- "assign <phase> <persona>" pins who works a standard gate.

Rules:
- Start from the standard flow and change as little as the task needs; most flows need no change or one.
- Use only phase ids and persona ids that appear in the context below. Never touch a gate marked locked or one that has begun.
- The crew: paul plans, ben builds, ralf reviews, tessa tests — pick by the personas listed.
- Reply in the owner's language.`;

/**
 * The system prompt of an improvement turn (E6, concept §4.8): the
 * aggregator reads one persona's friction log plus a short run history
 * and answers with improvement drafts. Same wire, same STRICT contract
 * style as the mission prompt — the reply parses as one JSON array.
 */
export const AGGREGATOR_SYSTEM_PROMPT = `You are the improvement aggregator for one tickets persona.

You read the persona's friction log — one line per thing that went wrong on a ticket — plus a short run history, and you propose concrete improvements as STRICTLY one JSON array and nothing outside it — no prose before or after, no markdown fences:
[{"target":"prompt.md|models.default|memory","title":"…","evidence":["<friction lines used>"],"content":"<replacement text / model id / lesson line>","lesson":"<optional short lesson>"}]
- "target" names what the draft changes: the persona's prompt.md, its models.default, or its memory.md.
- "title" is one short sentence naming the improvement.
- "evidence" quotes the friction lines the draft rests on — only lines from the input.
- "content" is the complete replacement: the full new prompt text, the model id, or the one-line memory lesson. It drops into the file as written.
- "lesson" is optional — a short lesson worth remembering once the draft is applied.

Rules:
- Propose at most 3 drafts; merge duplicate findings into one proposal.
- Every draft is backed by evidence from the input — never invent friction.
- Content must be concrete and complete, never a summary.`;

/** The config access the bridge needs — the engine's FileConfigStore fits. */
export interface ChatLlmConfig {
  get<T>(key: string): Promise<T | undefined>;
}

export interface ChatBridgeDeps {
  readonly config: ChatLlmConfig;
  /** The transport; the global fetch by default (the specs inject a fake). */
  readonly fetch?: typeof fetch;
  /** The system prompt of every turn; MISSION_SYSTEM_PROMPT by default (the aggregator passes its own). */
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
  const systemPrompt = deps.systemPrompt ?? MISSION_SYSTEM_PROMPT;

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
            ? `${FLOW_SYSTEM_PROMPT}\n\n## Flow\n\n${input.flow.context}`
            : shape === undefined
              ? `${systemPrompt}\n\n## Board digest\n\n${input.board}`
              : `${SHAPE_SYSTEM_PROMPT}\n\n## Ticket ${shape.ticket}\n\n${shape.ticketText}`;
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
