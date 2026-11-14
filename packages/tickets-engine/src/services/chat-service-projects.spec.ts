import { promises as fsp, type Dirent } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatBridge, ChatCommand } from '../contracts/chat';
import type { ProjectRecord } from '../contracts/projects';
import type { BoardSnapshot } from '../contracts/tickets';
import type { TicketsGit } from '../core/tickets-git';
import { ChatService, type ChatBoardPort } from './chat-service';
import type { EngineHost } from './host';

/**
 * req-298: Pia names the project of a ticket she creates. The turn's system
 * message carries the board's projects and the project filter the owner's
 * client stands on; her createTicket card takes the filter's project when
 * she names none (or one the board does not know); the confirm creates the
 * ticket in that project.
 */

const project = (id: string, name: string): ProjectRecord => ({ id, name, color: '#8ecbef', repos: [], folders: [], vaults: {}, purpose: '' });
const TWO = [project('drey', 'Drey'), project('lariscus', 'Lariscus')];

let root: string;
let vaultPath: string;
let projects: readonly ProjectRecord[];
let reply: ChatCommand[];
let boards: string[];
let created: unknown[];

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(tmpdir(), 'chat-projects-'));
  vaultPath = path.join(root, 'vault');
  await fsp.mkdir(vaultPath, { recursive: true });
  projects = TWO;
  reply = [{ kind: 'createTicket', title: 'Export as CSV', description: '', priority: 'normal', phase: 'inbox' }];
  boards = [];
  created = [];
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

async function walk(absDir: string, prefix: string, out: string[]): Promise<void> {
  for (const entry of await fsp.readdir(absDir, { withFileTypes: true }).catch(() => [] as Dirent[])) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await walk(path.join(absDir, entry.name), rel, out);
    } else if (entry.name.endsWith('.md')) {
      out.push(rel);
    }
  }
}

function boot(): ChatService {
  const host = {
    listVaults: async () => [{ id: 'vault', name: 'vault', path: vaultPath, exists: true, active: true }],
    read: async (_v: string, p: string) => fsp.readFile(path.join(vaultPath, p), 'utf8'),
    write: async (_v: string, p: string, text: string) => {
      await fsp.mkdir(path.dirname(path.join(vaultPath, p)), { recursive: true });
      await fsp.writeFile(path.join(vaultPath, p), text, 'utf8');
    },
    listMarkdownFiles: async () => {
      const out: string[] = [];
      await walk(vaultPath, '', out);
      return out;
    },
    announceChanges: () => undefined,
  } as unknown as EngineHost;
  const board = {
    snapshot: async () =>
      ({
        vaultId: 'vault',
        pipeline: [{ id: 'inbox' }, { id: 'done' }],
        priorities: { order: ['normal'], default: 'normal' },
        columns: [
          { phase: { id: 'inbox' }, tickets: [], unknown: false },
          { phase: { id: 'done' }, tickets: [], unknown: false },
        ],
        projects,
      }) as unknown as BoardSnapshot,
    createTicket: async (input: unknown) => {
      created.push(input);
      return { ok: true, id: 'T-0201' };
    },
  } as unknown as ChatBoardPort;
  const bridge = {
    runTurn: async (input: { board: string }) => {
      boards.push(input.board);
      return { say: 'Here is the card.', thought: null, commands: reply };
    },
  } as unknown as ChatBridge;
  const git = { locate: async (p: string) => ({ root: p, prefix: '' }), commitPaths: async () => undefined } as unknown as TicketsGit;
  let clock = Date.parse('2026-11-14T09:00:00Z');
  return new ChatService({ host, board, bridge, actor: 'owner@desk', log: () => undefined, onEvent: () => undefined, now: () => new Date((clock += 1000)), git });
}

describe("Pia's project of a new ticket (req-298)", () => {
  it('lists the projects and the filter in the turn; the card takes the filter project and the confirm creates it there', async () => {
    const service = boot();
    const turn = await service.start({ text: 'Capture: export the board as CSV', project: 'lariscus' });
    expect(boards[0]).toContain('## Projects\n\ndrey "Drey" · lariscus "Lariscus"');
    expect(boards[0]).toContain('project filter is Lariscus: a new ticket goes to "lariscus"');
    const card = turn.ok ? turn.proposals?.[0] : undefined;
    expect(card?.command).toMatchObject({ kind: 'createTicket', project: 'lariscus' });
    const decided = await service.confirm({ file: turn.file!, id: card!.id });
    expect(decided.ok).toBe(true);
    expect(created[0]).toMatchObject({ title: 'Export as CSV', project: 'lariscus', actor: 'owner@desk' });
  });

  it('under all projects tells Pia to ask, and a card that names none creates an unassigned ticket', async () => {
    const service = boot();
    const turn = await service.start({ text: 'Capture: export the board as CSV' });
    expect(boards[0]).toContain('project filter is all projects: unless the owner named the project, ask which project');
    const card = turn.ok ? turn.proposals?.[0] : undefined;
    expect(card?.command).not.toHaveProperty('project');
    await service.confirm({ file: turn.file!, id: card!.id });
    expect(created[0]).not.toHaveProperty('project');
  });

  it('keeps a project Pia named, and drops one the board does not know for the filter', async () => {
    const service = boot();
    reply = [{ kind: 'createTicket', title: 'A', description: '', priority: 'normal', phase: 'inbox', project: 'drey' }, { kind: 'createTicket', title: 'B', description: '', priority: 'normal', phase: 'inbox', project: 'nowhere' }];
    const turn = await service.start({ text: 'two ideas', project: 'lariscus' });
    const commands = turn.ok ? turn.proposals?.map((p) => p.command) : [];
    expect(commands).toMatchObject([{ project: 'drey' }, { project: 'lariscus' }]);
  });

  it("a board with one project: every new ticket goes to it, whatever the client sends; the card survives the file's round trip", async () => {
    projects = [project('drey', 'Drey')];
    const service = boot();
    const turn = await service.start({ text: 'Capture it' });
    expect(boards[0]).toContain('The board has one project: every new ticket goes to "drey".');
    const opened = await service.open(turn.file!);
    expect(opened?.proposals[0]?.command).toMatchObject({ kind: 'createTicket', project: 'drey' });
  });

  it('a board without project records gets no block and no project', async () => {
    projects = [];
    const service = boot();
    const turn = await service.send({ file: (await service.start({ text: 'hello' })).file!, text: 'capture it', project: 'drey' });
    expect(boards.every((board) => !board.includes('## Projects'))).toBe(true);
    expect(turn.ok ? turn.proposals?.[0]?.command : null).not.toHaveProperty('project');
  });
});
