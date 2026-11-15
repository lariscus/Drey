import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClosingRoundWrite } from '../contracts/persona-run-records';
import { personaLessonLine } from '../core/memory-line';
import type { Persona } from '../core/persona';
import { parseImprovements } from '../core/improvements';
import { RUN_JOURNAL_NOTE, type JournalEntry } from '../core/persona-journal';
import { parseJournal } from '../core/persona-journal-file';
import { TicketsGit } from '../core/tickets-git';
import { ChangeHub } from '../server/drey-port';
import { FileConfigStore } from '../server/file-config';
import { FsEngineHost } from '../server/standalone-host';
import type { EngineVault } from './host';
import { PersonaRunRecords } from './persona-run-records';

const run = promisify(execFile);
const PERSONAS = 'tickets/_meta/personas';

let root = '';
let vault = '';
const git = async (args: string[]): Promise<string> => (await run('git', args, { cwd: vault })).stdout;
const read = (rel: string): Promise<string | null> => fsp.readFile(path.join(vault, rel), 'utf8').catch(() => null);
const subjects = async (): Promise<string[]> => (await git(['log', '--format=%s'])).trim().split('\n');
const filesOf = async (ref: string): Promise<string[]> => (await git(['show', '--name-only', '--format=', ref])).trim().split('\n');

function records(): { records: PersonaRunRecords; git: TicketsGit } {
  const host = new FsEngineHost(vault, new FileConfigStore(path.join(root, 'config.json')), new ChangeHub(), () => undefined);
  const ticketsGit = new TicketsGit(() => 'git');
  const board = {
    detect: async (): Promise<EngineVault | null> => (await host.listVaults())[0] ?? null,
    loadPersona: async (_vault: EngineVault, id: string): Promise<Persona | null> => ((await read(`${PERSONAS}/${id}/persona.md`)) === null ? null : ({ id } as Persona)),
  };
  return { records: new PersonaRunRecords({ board, host, git: ticketsGit, now: () => new Date('2026-11-14T10:05:00.000Z') }), git: ticketsGit };
}

const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  at: '2026-11-14T10:05:00Z',
  ticket: 'T-0007',
  persona: 'ben',
  harness: 'claude-code',
  model: 'sonnet',
  gate: 'red',
  costUsd: 0.42,
  signals: ['red-gate'],
  friction: null,
  finding: { cause: 'prompt', text: 'the brief named no test command' },
  note: null,
  ...over,
});

const round = (over: Partial<ClosingRoundWrite> = {}): ClosingRoundWrite => ({
  vaultPath: vault,
  persona: 'ben',
  ticket: 'T-0007',
  runStartedAt: '2026-11-14T10:00:00.000Z',
  journal: entry(),
  lesson: personaLessonLine({ date: '2026-11-14', ticket: 'T-0007', persona: 'ben', model: 'sonnet', lesson: "run the repo's verify script" }),
  proposal: { target: 'prompt.md', title: 'Name the test command', content: '', edits: [{ old: 'Run the tests.', new: 'Run `npm test`.' }], evidence: 'the journal head' },
  ...over,
});

const author = { persona: 'ben', ticket: 'T-0007', harness: 'claude-code', model: 'sonnet' };

describe("the runs' persona writes on the engine side (req-225, req-226)", () => {
  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(tmpdir(), 'drey-run-records-'));
    vault = path.join(root, 'vault');
    await fsp.mkdir(path.join(vault, PERSONAS, 'ben'), { recursive: true });
    await fsp.writeFile(path.join(vault, PERSONAS, 'ben/persona.md'), '---\ntitle: Ben\n---\n', 'utf8');
    await fsp.writeFile(path.join(vault, PERSONAS, 'ben/prompt.md'), '# Ben\n\nRun the tests.\n', 'utf8');
    await git(['init', '-b', 'main']);
    await git(['config', 'user.name', 'spec']);
    await git(['config', 'user.email', 'spec@example.com']);
    await git(['add', '-A']);
    await git(['commit', '-m', 'seed']);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('a closing round lands as ONE commit `personas: <id> closing round <ticket>` with its journal entry, lesson and proposal', async () => {
    const { records: writer, git: ticketsGit } = records();
    const written = await writer.closingRound(round());
    await ticketsGit.idle();
    expect(written).toMatchObject({ ok: true, lesson: expect.stringContaining("run the repo's verify script"), proposal: 'imp-1' });
    expect(written.ok && written.warning).toBeUndefined();
    expect(await subjects()).toEqual(['personas: ben closing round T-0007', 'seed']);
    expect((await filesOf('HEAD')).sort()).toEqual([`${PERSONAS}/ben/improvements.md`, `${PERSONAS}/ben/memory.md`, `${PERSONAS}/ben/reviews.md`]);
    expect((await git(['status', '--porcelain'])).trim()).toBe('');
    expect(parseJournal((await read(`${PERSONAS}/ben/reviews.md`))!)).toEqual([entry()]);
    expect(parseImprovements((await read(`${PERSONAS}/ben/improvements.md`))!).proposals[0]).toMatchObject({ state: 'open', content: '# Ben\n\nRun `npm test`.' });
  });

  it("memory_write and journal_write are one commit each; the round then adds no second lesson and merges into the run's note", async () => {
    const { records: writer } = records();
    const memory = await writer.memoryWrite({ ...author, lesson: "Run the repo's verify script." });
    expect(memory).toEqual({ ok: true, line: "- 2026-11-14 · T-0007 · ben/sonnet · Run the repo's verify script." });
    expect(await writer.journalWrite({ ...author, note: 'guessed the test command' })).toMatchObject({ ok: true });
    const written = await writer.closingRound(round({ proposal: null }));
    expect(written).toMatchObject({ ok: true, lesson: null, proposal: null });
    expect(await subjects()).toEqual(['personas: ben closing round T-0007', 'personas: ben journal +1 (T-0007)', 'personas: ben memory +1 (T-0007)', 'seed']);
    expect((await read(`${PERSONAS}/ben/memory.md`))!.match(/verify script/g)).toHaveLength(1);
    const journal = parseJournal((await read(`${PERSONAS}/ben/reviews.md`))!);
    expect(journal).toEqual([entry({ friction: 'guessed the test command' })]);
  });

  it('a lesson already in memory is refused; a journal note carries the run note', async () => {
    const { records: writer } = records();
    await writer.memoryWrite({ ...author, lesson: 'keep commits small' });
    expect(await writer.memoryWrite({ ...author, ticket: 'T-0009', lesson: 'Keep commits small.' })).toEqual({ ok: false, error: 'your memory already holds this lesson — nothing was written' });
    await writer.journalWrite({ ...author, note: 'the brief named no test command' });
    expect(parseJournal((await read(`${PERSONAS}/ben/reviews.md`))!)[0]).toMatchObject({ gate: 'none', friction: 'the brief named no test command', note: RUN_JOURNAL_NOTE, harness: 'claude-code', model: 'sonnet' });
  });

  it('refuses another vault (foreign — the runner writes it itself) and an unknown persona', async () => {
    const { records: writer } = records();
    expect(await writer.closingRound(round({ vaultPath: path.join(root, 'elsewhere') }))).toMatchObject({ ok: false, foreign: true });
    expect(await writer.memoryWrite({ ...author, persona: 'nobody', lesson: 'x' })).toEqual({ ok: false, error: 'persona "nobody" does not exist' });
    expect(await subjects()).toEqual(['seed']);
  });

  it('a vault outside git keeps the write and says it is not versioned', async () => {
    await fsp.rm(path.join(vault, '.git'), { recursive: true, force: true });
    const { records: writer } = records();
    expect(await writer.memoryWrite({ ...author, lesson: 'keep commits small' })).toMatchObject({ ok: true, warning: 'the tickets vault is not a git repository — the change is not versioned' });
    expect(await read(`${PERSONAS}/ben/memory.md`)).toContain('keep commits small');
  });
});
