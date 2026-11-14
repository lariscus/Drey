import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../contracts/tickets';
import { parseChainItems } from '../core/chain-list';
import { crewOrderOf, inCrewOrder } from '../core/crew-order';
import { PERSONAS_DIR } from '../core/persona';
import { createChatBridge } from './chat-llm';
import { ChatVoices, type ChatVoicesBoard } from './chat-voices';
import { loadCrewPrompts } from './crew-prompts';
import { personaLoader } from './persona-loader';

/**
 * req-272: the Shape chat speaks as the assigned persona. The crew is
 * real files in a temp vault — `personas/<id>/persona.md` + `prompt.md`,
 * `crew.md`'s `order:` — read through the same loader the board uses, so a
 * rename, an edit of `prompt.md` or a reorder reaches the very next turn.
 */

const CREW = await loadCrewPrompts();
const TICKET = 'T-0130';
const CREW_MD = 'tickets/_meta/crew.md';

let root: string;
let standard: string[];
let chain: string[];

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(tmpdir(), 'chat-voices-'));
  standard = ['paul:shape', 'paul', 'ben', 'ralf', 'tessa', 'you'];
  chain = [];
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

async function put(rel: string, text: string): Promise<void> {
  await fsp.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fsp.writeFile(path.join(root, rel), text, 'utf8');
}

const persona = (id: string, front: string, prompt: string | null) =>
  Promise.all([put(`${PERSONAS_DIR}/${id}/persona.md`, `---\n${front}\n---\n`), prompt === null ? Promise.resolve() : put(`${PERSONAS_DIR}/${id}/prompt.md`, prompt)]);

async function seedCrew(): Promise<void> {
  await persona('paul', 'title: Paul\nrole: planner\nsummary: Plans the work.', '## Who Paul is\n\nPaul, the planner. He interviews first.\n');
  await persona('ben', 'title: Ben\nrole: builder\nsummary: Builds the plan.', '## Who Ben is\n\nBen builds.\n');
  await persona('ralf', 'title: Ralf\nrole: reviewer', '## Who Ralf is\n\nRalf reviews.\n');
  await persona('tessa', 'title: Tessa\nrole: tester\nsummary: Tests what was built.', '## Who Tessa is\n\nTessa tests.\n');
  await persona('you', 'title: You\nkind: human', null);
  await persona('pia', 'title: Pia\nkind: mission', '## Who Pia is\n\nPia.\n');
}

function boardOnDisk(): ChatVoicesBoard {
  const read = async (rel: string): Promise<string> => fsp.readFile(path.join(root, rel), 'utf8');
  return {
    detect: async () => ({ id: 'vault', name: 'vault', path: root, exists: true, active: true }),
    snapshot: async () => {
      const entries = (items: readonly string[]) => {
        const parsed = parseChainItems(items);
        return parsed.ok ? parsed.entries : [];
      };
      return {
        flow: entries(standard),
        columns: [{ phase: { id: 'inbox' }, tickets: [{ id: TICKET, meta: { ...(chain.length === 0 ? {} : { chain: entries(chain) }) } }] }],
      } as unknown as BoardSnapshot;
    },
    // What BoardService.listPersonas does: every persona directory through the loader, in `crew.md`'s order.
    listPersonas: async () => {
      const loader = personaLoader(read);
      const dirs = await fsp.readdir(path.join(root, PERSONAS_DIR)).catch(() => [] as string[]);
      const loaded = [];
      for (const id of dirs.sort()) {
        const one = await loader.load(id);
        if (one !== null) {
          loaded.push(one);
        }
      }
      return inCrewOrder(loaded, crewOrderOf(await read(CREW_MD).catch(() => null)));
    },
  };
}

const voices = () => new ChatVoices(boardOnDisk(), { read: async (_vault: string, rel: string) => fsp.readFile(path.join(root, rel), 'utf8') });

describe('the voice of a shape turn', () => {
  it("is the prompt of the persona of the chain's interactive entry, the version line and CRLF folded", async () => {
    await seedCrew();
    await put(`${PERSONAS_DIR}/paul/prompt.md`, '<!-- drey-prompt-version: 4 -->\r\n## Who Paul is\r\n\r\nPaul plans.\r\n');
    const voice = await voices().shape(TICKET);
    expect(voice.speaker).toBe('Paul');
    expect(voice.prompt).toBe('## Who Paul is\n\nPaul plans.');
  });

  it("reads the prompt on every call: a rename and an edit apply to the next turn", async () => {
    await seedCrew();
    standard = ['paula:shape', 'paula', 'ben'];
    await persona('paula', 'title: Paula\nrole: planner', '## Who Paula is\n\nPaula plans in German.\n');
    const source = voices();
    expect((await source.shape(TICKET)).prompt).toBe('## Who Paula is\n\nPaula plans in German.');
    await put(`${PERSONAS_DIR}/paula/prompt.md`, '## Who Paula is\n\nPaula plans in Dutch.\n');
    const after = await source.shape(TICKET);
    expect(after.speaker).toBe('Paula');
    expect(after.prompt).toBe('## Who Paula is\n\nPaula plans in Dutch.');
  });

  it('follows the ticket: another persona holding the interactive entry speaks', async () => {
    await seedCrew();
    chain = ['ralf:shape', 'paul', 'ben'];
    const voice = await voices().shape(TICKET);
    expect(voice.speaker).toBe('Ralf');
    expect(voice.prompt).toBe('## Who Ralf is\n\nRalf reviews.');
  });

  it('lists the crew as it stands now, agents only, in crew.md order', async () => {
    await seedCrew();
    await put(CREW_MD, '---\norder: [tessa, ben, paul, ralf, you]\n---\n');
    expect((await voices().shape(TICKET)).roster).toBe(
      ['- tessa (Tessa): Tests what was built.', '- ben (Ben): Builds the plan.', '- paul (Paul): Plans the work.', '- ralf (Ralf): reviewer'].join('\n'),
    );
    await fsp.rm(path.join(root, PERSONAS_DIR, 'tessa'), { recursive: true });
    await persona('quinn', 'title: Quinn\nrole: builder\nsummary: Builds, too.', '## Who Quinn is\n');
    await put(CREW_MD, '---\norder: [quinn, ben, paul, ralf]\n---\n');
    expect((await voices().shape(TICKET)).roster).toBe(
      ['- quinn (Quinn): Builds, too.', '- ben (Ben): Builds the plan.', '- paul (Paul): Plans the work.', '- ralf (Ralf): reviewer'].join('\n'),
    );
  });

  it('still lists the crew when no one speaks: the wrapper stands alone', async () => {
    await seedCrew();
    standard = ['ben', 'ralf'];
    const voice = await voices().shape(TICKET);
    expect(voice.speaker).toBeNull();
    expect(voice.prompt).toBeNull();
    expect(voice.roster).toContain('- ben (Ben): Builds the plan.');
  });

  it('is a voice without a prompt when the speaker has no prompt.md, and never throws without a vault', async () => {
    await seedCrew();
    await fsp.rm(path.join(root, PERSONAS_DIR, 'paul', 'prompt.md'));
    expect(await voices().shape(TICKET)).toMatchObject({ speaker: 'Paul', prompt: null });
    const broken = new ChatVoices({ ...boardOnDisk(), snapshot: async () => Promise.reject(new Error('no board')) }, { read: async () => '' });
    expect(await broken.shape(TICKET)).toEqual({ speaker: null, prompt: null, roster: '' });
  });
});

describe('the composed system message on the wire', () => {
  const config = { get: async <T,>(key: string) => ({ 'chat.baseUrl': 'http://llm/v1', 'chat.model': 'm' })[key] as T | undefined };

  function sse(content: string): Response {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`));
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  }

  async function shapeSystem(): Promise<string> {
    const sent: { messages: { role: string; content: string }[] }[] = [];
    const bridge = createChatBridge({
      crew: CREW,
      config,
      fetch: (async (_url: unknown, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)) as never);
        return sse(JSON.stringify({ say: 'ok' }));
      }) as typeof fetch,
    });
    const source = voices();
    const voice = await source.shape(TICKET);
    await bridge.runTurn({
      text: 'Go.',
      history: [],
      board: 'BOARD',
      shape: { ticket: TICKET, ticketText: 'TICKET TEXT', readFile: async () => ({ ok: false as const, error: 'none' }) },
      voice,
      emit: () => undefined,
    });
    return sent[0]!.messages[0]!.content;
  }

  it("opens a shape turn with the holder's prompt, then the wrapper, the crew and the ticket — no hard-coded Paul", async () => {
    await seedCrew();
    standard = ['paula:shape', 'paula', 'ben'];
    await persona('paula', 'title: Paula\nrole: planner\nsummary: Plans.', '## Who Paula is\n\nPaula, who asks one question at a time.\n');
    await put(CREW_MD, '---\norder: [ben, paula]\n---\n');
    const system = await shapeSystem();
    const at = (text: string) => system.indexOf(text);
    expect(system.startsWith('## Who Paula is\n\nPaula, who asks one question at a time.\n\nThe owner shapes one new ticket with you')).toBe(true);
    expect(at('STRICT output contract')).toBeGreaterThan(at('Paula, who asks'));
    expect(at('## Crew')).toBeGreaterThan(at('STRICT output contract'));
    expect(at('- ben (Ben): Builds the plan.')).toBeGreaterThan(at('## Crew'));
    expect(at('- paula (Paula): Plans.')).toBeGreaterThan(at('- ben (Ben)'));
    expect(at('## Ticket T-0130\n\nTICKET TEXT')).toBeGreaterThan(at('- paula (Paula)'));
    expect(system).not.toContain('You are Paul');
    expect(system).not.toContain('ben (builds)');
    expect(system).not.toContain('BOARD');
  });

  it('speaks with the wrapper alone when no prompt can be read', async () => {
    await seedCrew();
    await fsp.rm(path.join(root, PERSONAS_DIR, 'paul', 'prompt.md'));
    expect((await shapeSystem()).startsWith('The owner shapes one new ticket with you')).toBe(true);
  });
});
