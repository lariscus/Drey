import { promises as fsp, type Dirent } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatBridge } from '../contracts/chat';
import type { ProjectRecord } from '../contracts/projects';
import type { BoardSnapshot } from '../contracts/tickets';
import { parseSessionFile } from '../core/chat/chat-session';
import type { FollowupDraft } from '../core/ticket/followups';
import type { TicketsGit } from '../core/git/tickets-git';
import { ChatService, type ChatBoardPort } from './chat-service';
import { FollowupFiler } from './followup-filer';
import type { EngineHost } from './host';

/**
 * req-299: a done run's proposals become one session of pending
 * `createTicket` cards — written and committed by the filer, created as
 * tickets only by the owner's confirm through the chat's one decision path.
 */

const project = (id: string, name: string): ProjectRecord => ({ id, name, color: '#8ecbef', repos: [], folders: [], vaults: {}, purpose: '' });
const DRAFTS: readonly FollowupDraft[] = [
  { title: 'Cache the heading tree', why: 'the outline rebuilds it on every keystroke', priority: 'low' },
  { title: 'Drop the dead export', why: '', priority: 'urgent-ish' },
];

let root: string;
let vaultPath: string;
let hasVault: boolean;
let sourceTicket: boolean;
let commits: { paths: readonly string[]; message: string }[];
let announced: (readonly string[])[];
let created: unknown[];

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(tmpdir(), 'followup-filer-'));
  vaultPath = path.join(root, 'vault');
  await fsp.mkdir(vaultPath, { recursive: true });
  hasVault = true;
  sourceTicket = true;
  commits = [];
  announced = [];
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

const host = {
  listVaults: async () => (hasVault ? [{ id: 'vault', name: 'vault', path: vaultPath, exists: true, active: true }] : []),
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
  announceChanges: (_v: string, paths: readonly string[]) => announced.push(paths),
  resolveAssetPath: (_v: string, p: string) => path.join(vaultPath, p),
} as unknown as EngineHost;

const board = {
  snapshot: async () =>
    ({
      vaultId: hasVault ? 'vault' : null,
      pipeline: [{ id: 'inbox' }, { id: 'prioritized' }, { id: 'done' }],
      priorities: { order: ['urgent', 'normal', 'low'], default: 'normal' },
      columns: [
        { phase: { id: 'inbox' }, tickets: [], unknown: false },
        {
          phase: { id: 'prioritized' },
          tickets: sourceTicket ? [{ id: 'T-0086', phase: 'prioritized', meta: { title: 'Fix the CSV export', repo: 'drey', project: 'lariscus' } }] : [],
          unknown: false,
        },
        { phase: { id: 'done' }, tickets: [], unknown: false },
      ],
      projects: [project('drey', 'Drey'), project('lariscus', 'Lariscus')],
    }) as unknown as BoardSnapshot,
  createTicket: async (input: unknown) => {
    created.push(input);
    return { ok: true, id: 'T-0201' };
  },
} as unknown as ChatBoardPort;

const git = {
  locate: async (p: string) => ({ root: p, prefix: '' }),
  commitPaths: async (_root: string, paths: readonly string[], message: string) => {
    commits.push({ paths, message });
  },
} as unknown as TicketsGit;

function filer(): FollowupFiler {
  let clock = Date.parse('2026-11-14T09:00:00Z');
  return new FollowupFiler({ board, host, git, log: () => undefined, now: () => new Date((clock += 1000)) });
}

async function sessionOf(file: string): Promise<NonNullable<ReturnType<typeof parseSessionFile>>> {
  const text = await fsp.readFile(path.join(vaultPath, file), 'utf8');
  return parseSessionFile(text, file, { order: ['urgent', 'normal', 'low'], default: 'normal' })!;
}

describe('FollowupFiler — a run’s proposals as pending cards (req-299)', () => {
  it('writes one session with one pending createTicket card per proposal, in one commit', async () => {
    const filed = await filer().file({ ticket: 'T-0086', runId: 'R-1', drafts: DRAFTS });
    expect(filed.ok && filed.filed).toBe(2);
    const file = filed.ok ? filed.file! : '';
    expect(file).toMatch(/^tickets\/_meta\/chat\/\d{8}-\d{6}-follow-ups-from-t-0086\.md$/);

    const session = await sessionOf(file);
    expect(session.title).toBe('Follow-ups from T-0086');
    expect(session.ticket ?? null).toBeNull(); // no shape session: the ticket plan is not what is being talked about
    expect(session.messages[0]!.text).toBe(
      'Run R-1 of T-0086 (Fix the CSV export) proposes 2 follow-up tickets. Nothing is created until you confirm a card.',
    );
    expect(session.proposals.map((p) => p.state)).toEqual(['pending', 'pending']);
    expect(session.proposals[0]!.command).toEqual({
      kind: 'createTicket',
      title: 'Cache the heading tree',
      description: 'the outline rebuilds it on every keystroke\n\nProposed by the worker of T-0086 (run R-1).',
      priority: 'low',
      phase: 'inbox',
      repo: 'drey',
      project: 'lariscus',
    });
    // A word outside the board's vocabulary falls back to the default; no why leaves just the provenance line.
    expect(session.proposals[1]!.command).toMatchObject({ priority: 'normal', description: 'Proposed by the worker of T-0086 (run R-1).' });
    expect(commits).toEqual([{ paths: [file], message: 'tickets: follow-ups of T-0086 proposed (R-1)' }]);
    expect(announced).toEqual([[file]]);
  });

  it('is idempotent per run: a session that names the run is left alone, a later run files its own', async () => {
    const f = filer();
    const first = await f.file({ ticket: 'T-0086', runId: 'R-1', drafts: DRAFTS });
    const again = await f.file({ ticket: 'T-0086', runId: 'R-1', drafts: DRAFTS });
    const other = await f.file({ ticket: 'T-0086', runId: 'R-12', drafts: [{ title: 'Another thing', why: '', priority: null }] });
    expect(again).toEqual({ ok: true, file: first.ok ? first.file : null, filed: 0 });
    expect(other.ok && other.filed).toBe(1);
    expect(commits).toHaveLength(2);
  });

  it('does not propose a title the ticket’s earlier sessions already hold, whatever became of that card', async () => {
    const f = filer();
    await f.file({ ticket: 'T-0086', runId: 'R-1', drafts: DRAFTS });
    const next = await f.file({
      ticket: 'T-0086',
      runId: 'R-2',
      drafts: [{ title: 'cache the heading TREE', why: '', priority: null }, { title: 'A new finding', why: '', priority: null }],
    });
    const session = await sessionOf(next.ok ? next.file! : '');
    expect(session.proposals.map((p) => p.command.kind === 'createTicket' && p.command.title)).toEqual(['A new finding']);
    const onlyOld = await f.file({ ticket: 'T-0086', runId: 'R-3', drafts: [DRAFTS[0]!] });
    expect(onlyOld).toEqual({ ok: true, file: null, filed: 0 });
    expect(commits).toHaveLength(2);
  });

  it('a source ticket the board no longer lists files cards without a repo or project; the board’s only project would still apply', async () => {
    sourceTicket = false;
    const filed = await filer().file({ ticket: 'T-0086', runId: 'R-1', drafts: [DRAFTS[0]!] });
    const command = (await sessionOf(filed.ok ? filed.file! : '')).proposals[0]!.command;
    expect(command).not.toHaveProperty('repo');
    expect(command).not.toHaveProperty('project'); // two projects on this board: none is guessed
  });

  it('files nothing for no proposals, and refuses (retryable) without a tickets vault', async () => {
    expect(await filer().file({ ticket: 'T-0086', runId: 'R-1', drafts: [] })).toEqual({ ok: true, file: null, filed: 0 });
    hasVault = false;
    expect(await filer().file({ ticket: 'T-0086', runId: 'R-1', drafts: DRAFTS })).toEqual({ ok: false, error: 'no tickets vault detected' });
    expect(commits).toHaveLength(0);
  });

  it('the iron rule: nothing reaches the board until the owner confirms a card — then the ticket carries the repo and the project; a dismissed card leaves nothing', async () => {
    const filed = await filer().file({ ticket: 'T-0086', runId: 'R-1', drafts: DRAFTS });
    expect(created).toEqual([]);
    const file = filed.ok ? filed.file! : '';
    let clock = Date.parse('2026-11-14T10:00:00Z');
    const chat = new ChatService({
      host,
      board,
      bridge: {} as ChatBridge,
      actor: 'owner@desk',
      log: () => undefined,
      onEvent: () => undefined,
      now: () => new Date((clock += 1000)),
      git,
    });
    const [confirmed, dismissed] = (await chat.open(file))!.proposals;
    expect((await chat.confirm({ file, id: confirmed!.id })).ok).toBe(true);
    expect((await chat.dismiss({ file, id: dismissed!.id })).ok).toBe(true);
    expect(created).toEqual([
      {
        title: 'Cache the heading tree',
        description: 'the outline rebuilds it on every keystroke\n\nProposed by the worker of T-0086 (run R-1).',
        priority: 'low',
        repo: 'drey',
        project: 'lariscus',
        actor: 'owner@desk',
      },
    ]);
  });
});
