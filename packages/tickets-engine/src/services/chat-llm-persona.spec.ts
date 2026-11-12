import { describe, expect, it } from 'vitest';
import type { ChatShapeContext, ChatStreamEvent } from '../contracts/chat';
import { createChatBridge } from './chat-llm';
import { chatSystemOf } from './chat-system-prompt';
import { loadCrewPrompts } from './crew-prompts';

/** req-279: the real shipped crew prompts, so the wire assertions see the bytes a turn sends. */
const CREW = await loadCrewPrompts();

/**
 * Mission Control's persona prompt (req-269): the `prompt.md` of the
 * `kind: mission` persona opens the system message of a mission turn, read
 * on every turn; shape and flow turns, a bridge with its own system prompt
 * (the aggregator, a 1:1) and a turn without a persona prompt never carry it.
 */

const PIA = "## Who Pia is\n\nPia is Mission Control.\n\n## How the owner works with Pia\n\n- She answers briefly.";
const BOARD = '- inbox: T-0086 (normal)';

function config(): { get<T>(key: string): Promise<T | undefined> } {
  const values: Record<string, string> = { 'chat.baseUrl': 'http://127.0.0.1:1234/v1', 'chat.model': 'glm-5' };
  return { get: async <T,>(key: string) => values[key] as T | undefined };
}

/** A fetch stand-in that answers one envelope and records each request's system message. */
function recording(systems: string[]): typeof fetch {
  return (async (_url: unknown, init?: unknown) => {
    const body = JSON.parse(String((init as RequestInit).body)) as { messages: { role: string; content: string }[] };
    systems.push(body.messages[0]!.content);
    const frame = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '{"say":"Hi.","thought":"","commands":[]}' } }] })}\n\n`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frame));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  }) as typeof fetch;
}

const emit = (_event: ChatStreamEvent): void => undefined;

describe('chatSystemOf (req-269)', () => {
  const texts = { mission: 'MISSION', shape: 'SHAPE', flow: 'FLOW' };

  it('opens a mission turn with the persona prompt, then the mission prompt, then the board digest', () => {
    expect(chatSystemOf(texts, { board: BOARD, persona: `  ${PIA}\n\n` })).toBe(`${PIA}\n\nMISSION\n\n## Board digest\n\n${BOARD}`);
  });

  it('opens with the mission prompt alone without a persona prompt, or with a blank one', () => {
    expect(chatSystemOf(texts, { board: BOARD })).toBe(`MISSION\n\n## Board digest\n\n${BOARD}`);
    expect(chatSystemOf(texts, { board: BOARD, persona: null })).toBe(`MISSION\n\n## Board digest\n\n${BOARD}`);
    expect(chatSystemOf(texts, { board: BOARD, persona: ' \n ' })).toBe(`MISSION\n\n## Board digest\n\n${BOARD}`);
  });

  it('keeps shape and flow turns as they were, persona or not', () => {
    expect(chatSystemOf(texts, { board: BOARD, persona: PIA, shape: { ticket: 'T-0001', ticketText: 'Body.' } })).toBe('SHAPE\n\n## Ticket T-0001\n\nBody.');
    expect(chatSystemOf(texts, { board: BOARD, persona: PIA, flow: { context: 'Ctx.' } })).toBe('FLOW\n\n## Flow\n\nCtx.');
  });
});

describe('the bridge with Mission Control\'s persona (req-269)', () => {
  it('sends Pia\'s prompt first on a mission turn and reads it again on every turn', async () => {
    const systems: string[] = [];
    let prompt: string | null = PIA;
    let reads = 0;
    const bridge = createChatBridge({ crew: CREW, config: config(), fetch: recording(systems), missionPersona: async () => (reads++, prompt) });
    await bridge.runTurn({ text: 'Hi', history: [], board: BOARD, emit });
    prompt = '## Who Pia is\n\nEdited.';
    await bridge.runTurn({ text: 'Hi', history: [], board: BOARD, emit });
    prompt = null;
    await bridge.runTurn({ text: 'Hi', history: [], board: BOARD, emit });
    expect(reads).toBe(3);
    expect(systems[0]!.startsWith(`${PIA}\n\n${CREW.mission}\n\n## Board digest\n\n${BOARD}`)).toBe(true);
    expect(systems[1]!.startsWith(`## Who Pia is\n\nEdited.\n\n${CREW.mission}`)).toBe(true);
    expect(systems[2]!.startsWith(`${CREW.mission}\n\n## Board digest`)).toBe(true);
  });

  it('runs on the mission prompt alone when reading the persona fails', async () => {
    const systems: string[] = [];
    const bridge = createChatBridge({ crew: CREW, config: config(), fetch: recording(systems), missionPersona: () => Promise.reject(new Error('disk gone')) });
    const out = await bridge.runTurn({ text: 'Hi', history: [], board: BOARD, emit });
    expect(out.failure).toBeUndefined();
    expect(systems[0]!.startsWith(CREW.mission)).toBe(true);
  });

  it('never asks for the persona on a shape or flow turn, or on a bridge with its own system prompt', async () => {
    const systems: string[] = [];
    let reads = 0;
    const missionPersona = async (): Promise<string | null> => (reads++, PIA);
    const shape: ChatShapeContext = { ticket: 'T-0001', ticketText: 'Body.', readFile: async () => ({ ok: false, error: 'none' }) };
    await createChatBridge({ crew: CREW, config: config(), fetch: recording(systems), missionPersona }).runTurn({ text: 'Hi', history: [], board: BOARD, shape, emit });
    await createChatBridge({ crew: CREW, config: config(), fetch: recording(systems), missionPersona }).runTurn({ text: 'Hi', history: [], board: BOARD, flow: { context: 'Ctx.' }, emit });
    await createChatBridge({ crew: CREW, config: config(), fetch: recording(systems), missionPersona, systemPrompt: 'AGGREGATOR' }).runTurn({ text: 'Hi', history: [], board: BOARD, emit });
    expect(reads).toBe(0);
    expect(systems.every((system) => !system.includes('Who Pia is'))).toBe(true);
    expect(systems[2]!.startsWith('AGGREGATOR\n\n## Board digest')).toBe(true);
  });
});
