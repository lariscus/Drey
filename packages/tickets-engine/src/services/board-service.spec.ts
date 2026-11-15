import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EngineBoardService, type BoardServiceOptions } from './board-service';
import type { EngineHost, EngineVault, FleetPort } from './host';
import { TicketsGit } from '../core/tickets-git';
import { newTicketFileText } from '../core/ticket-files';
import type { LedgerWrite } from '../core/ledger';
import { normalizeFleetCaps, normalizeFleetHandover, normalizeFleetPools } from '../fleet/protocol';
import { PersonaAvatars } from './persona-avatars';
import { SHIPPED_PERSONAS_DIR } from './shipped-crew-files';

/**
 * E7: the board service's ledger writes and the status read, against a
 * real temp vault — a successful move writes the phase line, a terminal
 * Accept writes archived + merged, an archive writes archived, a refused
 * mutation writes nothing, and `statusOf` reads the ticket's status log
 * tolerant. E8 adds `setForm` (concept §5.6): the scout → ship
 * promotion's board half — the `form:` header flip, the `form <value>`
 * Log line, the no-op when the file already carries the form, the
 * live-run refusal. E9 adds `setChain` (concept §5.7): the chat's chain
 * delta — grammar parse per entry, the semantic guard against the
 * pipeline and the card's phase, the canonical `chain:` header rewrite,
 * the `chain <n entries|standard>` Log line, the no-op on an unchanged
 * delta, the live-run refusal. No git (every commit degrades to the
 * unversioned warning).
 */

const PIPELINE = `---
phases:
  - { id: inbox, title: Inbox, handover: manual }
  - { id: done, title: Done, handover: none }
---
The pipeline.
`;

let vaultDir = '';
let vault: EngineVault;
let ledgerWrites: LedgerWrite[];

beforeEach(async () => {
  vaultDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-board-svc-'));
  vault = { id: 'v', name: 'vault', path: vaultDir, exists: true, active: true };
  ledgerWrites = [];
  await fsp.mkdir(path.join(vaultDir, 'tickets', '_meta'), { recursive: true });
  await fsp.mkdir(path.join(vaultDir, 'tickets', 'inbox'), { recursive: true });
  await fsp.writeFile(path.join(vaultDir, 'tickets', '_meta', 'pipeline.md'), PIPELINE, 'utf8');
});

afterEach(async () => {
  await fsp.rm(vaultDir, { recursive: true, force: true });
});

/** Every markdown file under the vault, vault-relative with forward slashes. */
async function listMarkdownFiles(root: string, dir = ''): Promise<string[]> {
  const abs = dir === '' ? root : path.join(root, dir);
  const out: string[] = [];
  for (const entry of await fsp.readdir(abs, { withFileTypes: true }).catch(() => [])) {
    const rel = dir === '' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...(await listMarkdownFiles(root, rel)));
    } else if (entry.name.endsWith('.md')) {
      out.push(rel);
    }
  }
  return out;
}

function hostOf(): EngineHost {
  const abs = (p: string): string => path.join(vaultDir, ...p.split('/'));
  return {
    listVaults: async () => [vault],
    read: async (_vaultId, p) => fsp.readFile(abs(p), 'utf8'),
    writeAnnounced: async (_vaultId, p, text) => {
      await fsp.mkdir(path.dirname(abs(p)), { recursive: true });
      await fsp.writeFile(abs(p), text, 'utf8');
    },
    write: async (_vaultId, p, text) => {
      await fsp.mkdir(path.dirname(abs(p)), { recursive: true });
      await fsp.writeFile(abs(p), text, 'utf8');
    },
    listMarkdownFiles: async () => listMarkdownFiles(vaultDir),
    resolveAssetPath: (_vaultId, p) => abs(p),
    announceChanges: () => undefined,
    markManaged: () => undefined,
    configGet: async () => undefined,
    configSet: async () => undefined,
    emitBoardChanged: () => undefined,
    log: () => undefined,
    pickFolder: async () => null,
    revealPath: async () => '',
    launchInConsole: () => undefined,
  };
}

function serviceOf(options: BoardServiceOptions = {}): EngineBoardService {
  // A git whose every command fails: locate() answers null, so the one
  // commit per mutation degrades to the honest unversioned warning.
  const git = new TicketsGit(() => 'git', async () => {
    throw new Error('no git in the spec');
  });
  const fleet: FleetPort = {
    runs: async () => [],
    start: async () => ({ ok: false, error: 'not in the spec' }),
    configureChain: async () => undefined,
  };
  return new EngineBoardService(
    hostOf(),
    git,
    'opencode',
    'accept-edits',
    '',
    fleet,
    '/fleet',
    normalizeFleetCaps({}),
    normalizeFleetPools({}),
    normalizeFleetHandover({}),
    'owner@test',
    options,
  );
}

async function writeTicket(id: string, phase: string): Promise<void> {
  const text = newTicketFileText({
    id,
    title: `Ticket ${id}`,
    repo: null,
    priority: 'normal',
    rank: 5000,
    firstPhase: phase,
    now: new Date('2026-11-02T10:00:00Z'),
    actor: 'owner@test',
    description: 'Do the thing.',
  });
  await fsp.mkdir(path.join(vaultDir, 'tickets', phase), { recursive: true });
  await fsp.writeFile(path.join(vaultDir, 'tickets', phase, `${id}.md`), text, 'utf8');
}

describe('EngineBoardService E7 ledger writes', () => {
  it('a refused mutation writes nothing', async () => {
    await writeTicket('T-0001', 'inbox');
    const service = serviceOf({ events: { ledger: (write) => ledgerWrites.push(write) } });

    const outcome = await service.transition({ id: 'T-0001', from: 'done', to: 'inbox' });

    expect(outcome.ok).toBe(false);
    expect(ledgerWrites).toEqual([]);
  });

});

describe('EngineBoardService statusOf', () => {
  it('reads empty when the log or the ticket is absent', async () => {
    await writeTicket('T-0001', 'inbox');
    const service = serviceOf();
    await expect(service.statusOf('T-0001')).resolves.toEqual([]);
    await expect(service.statusOf('T-0099')).resolves.toEqual([]);
  });
});

describe('EngineBoardService setForm (E8)', () => {
  it('refuses a ticket that is not on the board', async () => {
    const service = serviceOf();

    const outcome = await service.setForm({ id: 'T-0099', form: 'ship' });

    expect(outcome).toEqual({ ok: false, error: 'T-0099 is not on the board' });
  });
});

// `setChain` reads the pipeline via the non-enqueueing `snapshot()` (the
// single-writer queue must never be re-entered from inside an op).
describe('EngineBoardService setChain (req-266: the chain as a persona list)', () => {
  const CHAIN_PIPELINE = `---
phases:
  - { id: inbox, title: Inbox, handover: manual }
  - { id: build, title: Build, handover: manual }
  - { id: review, title: Review, handover: manual }
  - { id: verify, title: Verify, handover: manual }
  - { id: done, title: Done, handover: none }
flow: ben; ralf; you
---
The pipeline.
`;

  beforeEach(async () => {
    await fsp.writeFile(path.join(vaultDir, 'tickets', '_meta', 'pipeline.md'), CHAIN_PIPELINE, 'utf8');
    for (const id of ['ben', 'ralf', 'pia']) {
      await fsp.mkdir(path.join(vaultDir, 'tickets', '_meta', 'personas', id), { recursive: true });
      await fsp.writeFile(path.join(vaultDir, 'tickets', '_meta', 'personas', id, 'persona.md'), `---\ntitle: ${id}\nrole: builder\n---\n\nWho.\n`, 'utf8');
    }
  });

  it('refuses a ticket that is not on the board', async () => {
    const service = serviceOf();

    const outcome = await service.setChain({ id: 'T-0099', chain: ['skip verify'] });

    expect(outcome).toEqual({ ok: false, error: 'T-0099 is not on the board' });
  });
});

// `setBlockedBy` follows the setChain pattern: the pipeline read runs
// through the non-enqueueing `snapshot()` (inside findCard) — the
// single-writer queue is never re-entered from inside an op.
describe('EngineBoardService setBlockedBy (T-0050)', () => {
  it('refuses a ticket that is not on the board', async () => {
    const service = serviceOf();

    const outcome = await service.setBlockedBy({ id: 'T-0099', blockedBy: ['T-0001'] });

    expect(outcome).toEqual({ ok: false, error: 'T-0099 is not on the board' });
  });
});

describe('EngineBoardService configurable priorities (T0)', () => {
  const VOCAB_PIPELINE = `---
priorities: [p0, p1, p2]
phases:
  - { id: inbox, title: Inbox, handover: manual }
  - { id: done, title: Done, handover: none }
---
The pipeline.
`;

  beforeEach(async () => {
    await fsp.writeFile(path.join(vaultDir, 'tickets', '_meta', 'pipeline.md'), VOCAB_PIPELINE, 'utf8');
  });

  it('createTicket refuses a priority the vocabulary does not carry', async () => {
    const service = serviceOf();

    const outcome = await service.createTicket({
      title: 'Off-vocabulary',
      description: 'Do the thing.',
      priority: 'high',
      repo: null,
    });

    expect(outcome).toEqual({
      ok: false,
      error: 'unknown priority "high" — this board\'s vocabulary is p0, p1, p2',
    });
  });

});

describe('persona thread, memory pin and patch (U4, concept §4.4/§4.5)', () => {
  const PERSONA_DIR = ['tickets', '_meta', 'personas', 'pia'];

  async function writePia(): Promise<void> {
    await fsp.mkdir(path.join(vaultDir, ...PERSONA_DIR), { recursive: true });
    await fsp.writeFile(
      path.join(vaultDir, ...PERSONA_DIR, 'persona.md'),
      "---\ntitle: Pia\nrole: builder\nworker: claude-code\nmodels:\n  default: opus\n  pool: [opus]\n  router: off\ncolor: '#a78bfa'\nskills: []\n---\n\nPia plans carefully.\n",
      'utf8',
    );
  }

  it('personaMemoryAppend appends through the persona store and personaMemory reads entries with pins', async () => {
    await writePia();
    const service = serviceOf();

    const appended = await service.personaMemoryAppend({ id: 'pia', text: 'gate red on lint means fix lint first' });
    if (!appended.ok) {
      throw new Error(appended.error);
    }
    // req-169: the owner's line names its author and date; the read carries both.
    const day = new Date().toISOString().slice(0, 10);
    const line = `${day} · you · gate red on lint means fix lint first`;
    expect(appended.entries).toEqual([{ text: line, pinned: false, author: 'you', model: null, date: day, ticket: null, lesson: 'gate red on lint means fix lint first' }]);
    const file = await fsp.readFile(path.join(vaultDir, ...PERSONA_DIR, 'memory.md'), 'utf8');
    expect(file).toBe(`# Memory\n\n- ${line}\n`);

    const pinned = await service.personaMemoryPin({ id: 'pia', index: 0, pinned: true });
    if (!pinned.ok) {
      throw new Error(pinned.error);
    }
    expect(pinned.entries).toMatchObject([{ text: line, pinned: true }]);
    expect(await fsp.readFile(path.join(vaultDir, ...PERSONA_DIR, 'memory.md'), 'utf8')).toBe(`# Memory\n\n- ${line} [pinned]\n`);
    const unpinned = await service.personaMemoryPin({ id: 'pia', index: 0, pinned: false });
    if (!unpinned.ok) {
      throw new Error(unpinned.error);
    }
    expect(unpinned.entries).toMatchObject([{ text: line, pinned: false }]);
    expect(await service.personaMemory('pia')).toMatchObject({ ok: true, entries: [{ text: line, pinned: false, author: 'you' }] });
  });

  it('the pin toggle refuses out-of-range indexes and memory-less personas with a readable error', async () => {
    await writePia();
    const service = serviceOf();
    expect(await service.personaMemoryPin({ id: 'pia', index: 0, pinned: true })).toEqual({
      ok: false,
      error: 'persona "pia" has no memory entries yet',
    });
    await service.personaMemoryAppend({ id: 'pia', text: 'one' });
    expect(await service.personaMemoryPin({ id: 'pia', index: 3, pinned: true })).toEqual({
      ok: false,
      error: 'no memory entry at index 3',
    });
    expect(await service.personaMemoryPin({ id: 'pia', index: -1, pinned: true })).toMatchObject({ ok: false });
  });

  it('every persona-scoped method refuses an unknown persona id', async () => {
    const service = serviceOf();
    const missing = { ok: false, error: 'persona "ghost" does not exist — create tickets/_meta/personas/ghost/persona.md first' };
    expect(await service.personaMemory('ghost')).toEqual(missing);
    expect(await service.personaMemoryAppend({ id: 'ghost', text: 'x' })).toEqual(missing);
    expect(await service.personaMemoryPin({ id: 'ghost', index: 0, pinned: true })).toEqual(missing);
    expect(await service.personaPatch({ id: 'ghost', title: 'X' })).toEqual(missing);
  });

  it('personaPatch writes the one line and the allowed keys it is sent, in one commit-sized write, and leaves the other keys (req-171)', async () => {
    await writePia();
    const service = serviceOf();
    const outcome = await service.personaPatch({
      id: 'pia',
      summary: '  Plans one part,\n test first. ',
      budget: 7.5,
      allowed: { spendAboveAllowance: true, runCommands: 'bypass', network: true, writeNotes: true },
    });
    expect(outcome.ok).toBe(true);
    const pia = (await service.listPersonas()).find((p) => p.id === 'pia');
    expect(pia?.summary).toBe('Plans one part, test first.');
    expect(pia?.budget).toBe(7.5);
    expect(pia?.allowed).toEqual({ spendAboveAllowance: true, runCommands: 'bypass', network: true, writeNotes: true });
    const cleared = await service.personaPatch({ id: 'pia', budget: null, allowed: { runCommands: null, network: false, writeNotes: false } });
    expect(cleared.ok).toBe(true);
    const after = (await service.listPersonas()).find((p) => p.id === 'pia');
    expect(after?.allowed).toEqual({ spendAboveAllowance: true });
    expect(after?.summary).toBe('Plans one part, test first.');
    expect(after?.budget).toBeNull();
    expect(await service.personaPatch({ id: 'pia', budget: -1 })).toMatchObject({ ok: false });
    expect(await service.personaPatch({ id: 'pia', allowed: { runCommands: 'root' as never } })).toMatchObject({ ok: false });
  });

  it('personaPatch writes only the sent keys over personaFileText and keeps the prose', async () => {
    await writePia();
    const service = serviceOf();

    const outcome = await service.personaPatch({
      id: 'pia',
      class: 'standard',
      model: 'claude-code/sonnet',
      color: '#ff8800',
      skills: ['diff-review'],
      prompt: 'You are Pia, the careful planner.\n',
    });
    expect(outcome.ok).toBe(true);
    const personaMd = await fsp.readFile(path.join(vaultDir, ...PERSONA_DIR, 'persona.md'), 'utf8');
    // req-288: class and the pinned model replace worker and models; the v2 keys leave with the patch
    expect(personaMd).toContain('class: standard\nmodel: "claude-code/sonnet"\n');
    expect(personaMd).not.toMatch(/^(worker|models|min-class):|router:/m);
    expect(personaMd).toContain("color: '#ff8800'");
    expect(personaMd).toContain('skills: [diff-review]');
    expect(personaMd).toContain('role: builder'); // not sent — untouched
    expect(personaMd).toContain('Pia plans carefully.'); // the owner's prose survives
    expect(personaMd).not.toContain('Who Pia is: role, tone, limits');
    const promptMd = await fsp.readFile(path.join(vaultDir, ...PERSONA_DIR, 'prompt.md'), 'utf8');
    expect(promptMd).toBe('You are Pia, the careful planner.\n');
    // the rewritten file parses back to the same persona plus the changes
    const parsed = await service.listPersonas();
    const pia = parsed.find((p) => p.id === 'pia');
    expect(pia).toMatchObject({ class: 'standard', model: 'claude-code/sonnet' });
    expect(pia).not.toHaveProperty('legacy');
    // req-288: null pins nothing — the next free model of the class
    expect(await service.personaPatch({ id: 'pia', model: null })).toMatchObject({ ok: true });
    expect((await service.listPersonas()).find((p) => p.id === 'pia')).toMatchObject({ class: 'standard', model: null });
    expect(pia?.skills).toEqual(['diff-review']);
  });

  it('personaPatch validates the listed rules and changes nothing on a refusal', async () => {
    await writePia();
    const service = serviceOf();
    const before = await fsp.readFile(path.join(vaultDir, ...PERSONA_DIR, 'persona.md'), 'utf8');

    expect(await service.personaPatch({ id: 'pia', color: 'red' })).toEqual({ ok: false, error: 'the color is a #rrggbb hex value' });
    expect(await service.personaPatch({ id: 'pia', class: 'Not a class!' })).toMatchObject({ ok: false, error: expect.stringContaining('the class is a class name') });
    expect(await service.personaPatch({ id: 'pia', title: '  ' })).toEqual({ ok: false, error: 'the title is not empty' });
    expect(await service.personaPatch({ id: 'pia', role: 'wizard' })).toMatchObject({ ok: false });
    expect(await fsp.readFile(path.join(vaultDir, ...PERSONA_DIR, 'persona.md'), 'utf8')).toBe(before);
  });

  it('personaPatch treats a patch without any writable key as a no-op and a multi-key patch as one commit shape', async () => {
    await writePia();
    const service = serviceOf();
    expect(await service.personaPatch({ id: 'pia' })).toEqual({ ok: true });
    const outcome = await service.personaPatch({ id: 'pia', title: 'Pia P.', model: 'gpt-5' });
    expect(outcome.ok).toBe(true);
    const personaMd = await fsp.readFile(path.join(vaultDir, ...PERSONA_DIR, 'persona.md'), 'utf8');
    expect(personaMd).toContain('title: Pia P.');
    expect(personaMd).toContain('model: "gpt-5"'); // req-288: a pin sent to a v2 record migrates it (its old floor, else heavy)
    expect(personaMd).toContain('class: heavy');
  });
});

// E10-3: the shape turn's two board seams — the plan chapter write and the
// read-only look into the ticket's repository.
describe('EngineBoardService shape seams (E10-3)', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'shape-repo-'));
    await fsp.mkdir(path.join(repoDir, 'src'), { recursive: true });
    await fsp.mkdir(path.join(repoDir, '.git'), { recursive: true });
    await fsp.writeFile(path.join(repoDir, 'CLAUDE.md'), 'rules', 'utf8');
    await fsp.writeFile(path.join(repoDir, 'src', 'a.ts'), 'export const a = 1;', 'utf8');
    await fsp.writeFile(path.join(repoDir, '.env'), 'SECRET=1', 'utf8');
    await fsp.writeFile(path.join(repoDir, '.git', 'config'), 'x', 'utf8');
    await fsp.writeFile(path.join(repoDir, 'logo.bin'), Buffer.from([1, 0, 2]));
    await fsp.writeFile(
      path.join(vaultDir, 'tickets', '_meta', 'repos.md'),
      `---\nrepos:\n  demo:\n    url: https://example.com/demo.git\n    path: '${repoDir.replace(/\\/g, '/')}'\n---\n`,
      'utf8',
    );
  });

  afterEach(async () => {
    await fsp.rm(repoDir, { recursive: true, force: true });
  });

  it('setPlan refuses an unknown ticket', async () => {
    expect(await serviceOf().setPlan({ id: 'T-0999', plan: 'x' })).toEqual({ ok: false, error: 'T-0999 is not on the board' });
  });

  it('refuses without a repository', async () => {
    await writeTicket('T-0001', 'inbox');
    expect((await serviceOf().readRepoFile('T-0001', 'CLAUDE.md')).ok).toBe(false);
  });
});

describe('EngineBoardService default pipeline (req-99a)', () => {
  const pipelinePath = (): string => path.join(vaultDir, 'tickets', '_meta', 'pipeline.md');

  it('seeds the persona board pipeline: Inbox · Prioritized · Done and the standard flow (req-307)', async () => {
    await fsp.rm(pipelinePath());
    expect(await serviceOf().initialize('v')).toMatchObject({ ok: true });

    const snap = await serviceOf().snapshot();
    expect(snap.pipeline.map((p) => [p.id, p.title])).toEqual([
      ['inbox', 'Inbox'],
      ['prioritized', 'Prioritized'],
      ['done', 'Done'],
    ]);
    expect(snap.flow?.map((e) => e.persona)).toEqual(['paul', 'ben', 'ralf', 'tessa', 'you']);
    // The human persona exists from the first minute, titled You.
    const personaFile = await fsp.readFile(path.join(vaultDir, 'tickets', '_meta', 'personas', 'you', 'persona.md'), 'utf8');
    expect(personaFile).toContain('kind: human');
    expect(personaFile).toMatch(/title: ['"]?You['"]?\s/);
    // req-267: the sign-off's merge is You's commit leaving action, no prompt.
    expect(personaFile).toContain('leaving: [commit]');
    await expect(fsp.stat(path.join(vaultDir, 'tickets', '_meta', 'prompts'))).rejects.toThrow();
  });

  it('renames the human persona: one title on the persona file, blank goes back to You', async () => {
    await fsp.rm(pipelinePath());
    expect(await serviceOf().initialize('v')).toMatchObject({ ok: true });
    const file = path.join(vaultDir, 'tickets', '_meta', 'personas', 'you', 'persona.md');

    expect(await serviceOf().setHumanName('  Henrik ')).toMatchObject({ ok: true });
    expect(await fsp.readFile(file, 'utf8')).toMatch(/title: ['"]?Henrik['"]?\s/);
    const named = await serviceOf().listPersonas();
    expect(named.filter((p) => p.kind === 'human').map((p) => [p.id, p.title])).toEqual([['you', 'Henrik']]);

    expect(await serviceOf().setHumanName('')).toMatchObject({ ok: true });
    expect((await serviceOf().listPersonas()).find((p) => p.kind === 'human')?.title).toBe('You');
  });

  it('req-292: the human persona is created with its shipped picture, never over one that is there', async () => {
    const avatars = new PersonaAvatars({ resolveAssetPath: (_vault, rel) => path.join(vaultDir, rel) });
    const picture = path.join(vaultDir, 'tickets', '_meta', 'personas', 'you', 'avatar.png');
    const shipped = await fsp.readFile(path.join(SHIPPED_PERSONAS_DIR, 'you', 'avatar.png'));
    await fsp.rm(pipelinePath());
    expect(await serviceOf({ avatars }).initialize('v')).toMatchObject({ ok: true });
    expect((await fsp.readFile(picture)).equals(shipped)).toBe(true);
    await fsp.rm(path.dirname(picture), { recursive: true, force: true });
    await serviceOf({ avatars }).ensureHumanPersona();
    expect((await fsp.readFile(picture)).equals(shipped)).toBe(true);
    await fsp.rm(path.join(path.dirname(picture), 'persona.md'));
    await fsp.writeFile(picture, 'mine');
    await serviceOf({ avatars }).ensureHumanPersona();
    expect(await fsp.readFile(picture, 'utf8')).toBe('mine');
  });

  it('an existing board gets the human persona created on first sight and keeps its columns', async () => {
    const before = (await serviceOf().snapshot()).pipeline.map((p) => p.id);
    await serviceOf().ensureHumanPersona();
    expect((await serviceOf().listPersonas()).some((p) => p.kind === 'human' && p.title === 'You')).toBe(true);
    expect((await serviceOf().snapshot()).pipeline.map((p) => p.id)).toEqual(before);
  });

  it('leaves a board with the old default pipeline exactly as it is', async () => {
    const oldDefault = [
      '---',
      'phases:',
      '  - { id: inbox, title: Inbox, handover: manual }',
      '  - { id: prioritized, title: Prioritized, handover: manual }',
      '  - { id: build, title: Build, wip: 3, claim: true, handover: agent build-default }',
      '  - { id: commit, title: Commit, handover: agent commit-default }',
      '  - { id: done, title: Done, handover: none }',
      '---',
      'Mine.',
      '',
    ].join('\n');
    await fsp.writeFile(pipelinePath(), oldDefault);
    expect(await serviceOf().initialize('v')).toMatchObject({ ok: false });
    expect(await fsp.readFile(pipelinePath(), 'utf8')).toBe(oldDefault);

    const snap = await serviceOf().snapshot();
    expect(snap.pipeline.map((p) => [p.id, p.title])).toEqual([
      ['inbox', 'Inbox'],
      ['prioritized', 'Prioritized'],
      ['build', 'Build'],
      ['commit', 'Commit'],
      ['done', 'Done'],
    ]);
    expect([...snap.checkpoints]).toEqual([]);
  });

  it('never renames what a board already has: an existing Inbox title stays', async () => {
    const before = await fsp.readFile(pipelinePath(), 'utf8');
    expect(await serviceOf().initialize('v')).toMatchObject({ ok: false });
    expect(await fsp.readFile(pipelinePath(), 'utf8')).toBe(before);

    const snap = await serviceOf().snapshot();
    expect(snap.pipeline.map((p) => p.title)).toEqual(['Inbox', 'Done']);
  });
});

