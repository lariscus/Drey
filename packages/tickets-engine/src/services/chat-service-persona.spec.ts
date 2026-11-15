import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatBridge, ChatCommand, ChatStreamEvent } from '../contracts/chat';
import type { BoardSnapshot } from '../contracts/tickets';
import { humanPersona, parsePersonaFile, PERSONAS_DIR } from '../core/persona/persona';
import type { TicketsGit } from '../core/git/tickets-git';
import { ChatService, type ChatBoardPort } from './chat-service';
import type { EngineHost } from './host';

/**
 * The patchPersona card end to end (req-315): the bridge proposes, the
 * summary is set against the crew read just now, a prompt patch carries its
 * diff, and the confirm writes through the board port's `personaPatch` —
 * the Persona page's own method — or refuses beyond a kind's fields.
 */

let root: string;
let vaultPath: string;
let patches: Record<string, unknown>[];
let personaList: ReturnType<typeof parsePersonaFile>[];
let patchResult: { ok: boolean; error?: string };
let service: ChatService;
let lastBridgeInput: { tools?: unknown; board: string } | null;

const bridge = {
  runTurn: async (input: { text: string; board: string; tools?: unknown; emit: (event: ChatStreamEvent) => void }) => {
    lastBridgeInput = { tools: input.tools, board: input.board };
    input.emit({ kind: 'text', text: '' });
    return {
      say: 'Done.',
      thought: null,
      commands: (bridge as unknown as { reply?: { commands: ChatCommand[] } }).reply?.commands ?? [],
    };
  },
} as unknown as ChatBridge;

function boot(): ChatService {
  const host = {
    listVaults: async () => [{ id: 'vault', name: 'v', path: vaultPath, exists: true, active: true }],
    read: async (_vault: string, p: string) => fsp.readFile(path.join(vaultPath, p), 'utf8'),
    write: async (_vault: string, p: string, text: string) => {
      await fsp.mkdir(path.dirname(path.join(vaultPath, p)), { recursive: true });
      await fsp.writeFile(path.join(vaultPath, p), text, 'utf8');
    },
    listMarkdownFiles: async () => [],
    resolveAssetPath: (_v: string, p: string) => path.join(vaultPath, p),
    announceChanges: () => undefined,
  } as unknown as EngineHost;
  const board = {
    snapshot: async () =>
      ({
        vaultId: 'vault',
        pipeline: [{ id: 'inbox' }, { id: 'done' }],
        priorities: { order: ['normal'], default: 'normal' },
        columns: [],
      }) as unknown as BoardSnapshot,
    personas: async () => personaList,
    personaPatch: async (input: Record<string, unknown>) => {
      patches.push(input);
      return patchResult;
    },
    setStandardFlow: async () => ({ ok: true as const }),
  } as unknown as ChatBoardPort;
  const git = { locate: async () => null } as unknown as TicketsGit;
  return new ChatService({
    personas: async () => personaList,
    board,
    host,
    bridge,
    git,
    actor: 'owner@desk',
    onEvent: () => undefined,
    now: () => new Date('2026-11-15T09:00:00Z'),
  });
}

type ProposalView = NonNullable<Awaited<ReturnType<ChatService['open']>>>['proposals'][number];

async function startWith(commands: ChatCommand[]): Promise<{ file: string; proposals: readonly ProposalView[] }> {
  (bridge as unknown as { reply: { commands: ChatCommand[] } }).reply = { commands };
  const started = await service.start({ text: 'Set Ben\'s budget to 10.' });
  expect(started.ok).toBe(true);
  const file = started.file!;
  const session = await service.open(file);
  return { file, proposals: session!.proposals };
}

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(tmpdir(), 'chat-service-persona-'));
  vaultPath = path.join(root, 'vault');
  await fsp.mkdir(path.join(vaultPath, PERSONAS_DIR, 'ben'), { recursive: true });
  await fsp.writeFile(path.join(vaultPath, PERSONAS_DIR, 'ben', 'prompt.md'), '# Who Ben is\n', 'utf8');
  patches = [];
  patchResult = { ok: true };
  personaList = [
    parsePersonaFile('ben', '---\ntitle: Ben\nrole: builder\nclass: standard\nbudget: 5\nskills: [review]\n---\n'),
    humanPersona('You'),
  ];
  service = boot();
  lastBridgeInput = null;
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe('the patchPersona card', () => {
  it('shows old → new per sent field and executes through personaPatch', async () => {
    const { file, proposals } = await startWith([{ kind: 'patchPersona', persona: 'ben', patch: { budget: 10 } }]);
    expect(proposals[0]!.summary).toBe('Patch Ben — budget $5 → $10');
    const decided = await service.confirm({ file, id: proposals[0]!.id });
    expect(decided.ok).toBe(true);
    expect(decided.proposal!.outcome).toBe('ok');
    expect(patches).toEqual([{ id: 'ben', budget: 10 }]);
  });

  it('a prompt patch carries its before/after diff on the card', async () => {
    const { proposals } = await startWith([{ kind: 'patchPersona', persona: 'ben', patch: { prompt: '# Who Ben is\nHe builds.\n' } }]);
    expect(proposals[0]!.summary).toContain('instructions: 1 edit · +1 −0');
    expect(proposals[0]!.diff).toContain('+ He builds.');
    expect(proposals[0]!.diff).toContain('@@ line 2');
  });

  it('the session file keeps the diff fence for a later read', async () => {
    const started = await service.start({ text: 'Rewrite Ben.' });
    void started;
    const files = await fsp.readdir(path.join(vaultPath, 'tickets/_meta/chat'));
    const text = await fsp.readFile(path.join(vaultPath, 'tickets/_meta/chat', files[0]!), 'utf8');
    expect(text).toContain('```diff');
  });

  it('an unknown persona degrades the summary to the field names, and the confirm refuses', async () => {
    personaList = [];
    const { file, proposals } = await startWith([{ kind: 'patchPersona', persona: 'ghost', patch: { budget: 1 } }]);
    expect(proposals[0]!.summary).toBe('Patch ghost — budget');
    const decided = await service.confirm({ file, id: proposals[0]!.id });
    expect(decided.ok).toBe(false);
    expect(decided.error).toContain('no persona "ghost"');
    expect(patches).toEqual([]);
  });

  it('the kind rule refuses before anything is written', async () => {
    const { file, proposals } = await startWith([{ kind: 'patchPersona', persona: 'you', patch: { budget: 5 } }]);
    expect(proposals[0]!.summary).toContain('budget none → $5');
    const decided = await service.confirm({ file, id: proposals[0]!.id });
    expect(decided.ok).toBe(false);
    expect(decided.error).toContain("the owner's persona takes only");
    expect(patches).toEqual([]);
  });

  it('a broken value is personaPatchError\'s refusal, the card stays pending', async () => {
    patchResult = { ok: false, error: 'the class is a class name of Settings → Models' };
    const { file, proposals } = await startWith([{ kind: 'patchPersona', persona: 'ben', patch: { class: 'Not a class!' } }]);
    const decided = await service.confirm({ file, id: proposals[0]!.id });
    expect(decided.ok).toBe(false);
    expect(decided.error).toContain('the class is a class name');
  });

  it('an ordinary mission turn carries the tools; the blocks ride the system message', async () => {
    const seam = { specs: [], call: async () => 'ok' };
    service = new ChatService({
      personas: async () => personaList,
      board: (service as unknown as { deps: Record<string, unknown> })['deps']['board'] as ChatBoardPort,
      host: (service as unknown as { deps: Record<string, unknown> })['deps']['host'] as EngineHost,
      bridge,
      git: { locate: async () => null } as unknown as TicketsGit,
      actor: 'owner@desk',
      onEvent: () => undefined,
      personaContext: { text: async () => '## Crew settings' },
      ownerBlock: { text: async () => '## The owner' },
      tools: seam,
      now: () => new Date('2026-11-15T09:00:00Z'),
    });
    await service.start({ text: 'What does Ben do?' });
    expect(lastBridgeInput?.tools).toBe(seam);
    expect(lastBridgeInput?.board).toContain('## Crew settings');
    expect(lastBridgeInput?.board).toContain('## The owner');
  });
});
