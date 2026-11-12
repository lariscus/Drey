import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EngineBoardService } from './board-service';
import type { EngineHost, EngineVault, FleetPort } from './host';
import { TicketsGit } from '../core/tickets-git';
import { newTicketFileText, patchTicketFile } from '../core/ticket-files';
import { normalizeFleetCaps, normalizeFleetHandover, normalizeFleetPools } from '../fleet/protocol';

/**
 * E10-5: the flow editor against a real temp vault -- a ticket's chain and
 * one plan part's chain: the view with personas and models, the pure
 * edits, and the save (ticket header / the part's line in the parent's
 * `### Parts`).
 */

const PIPELINE = `---
phases:
  - { id: inbox, title: Inbox, handover: manual }
  - { id: build, title: Build, handover: manual, persona: ben }
  - { id: review, title: Review, handover: manual, persona: ralf }
  - { id: verify, title: Verify, handover: manual }
  - { id: security, title: Security, handover: manual }
  - { id: commit, title: Commit, handover: manual }
  - { id: done, title: Done, handover: none }
flow: paul:shape; paul; ben; ralf
---
The pipeline.
`;

const PARENT_PLAN = `
## Plan

Goal text.

### Parts

- [ ] Capture window
  persona: ben
  reason: small and isolated
- [ ] Dictation hand-off
  chain: ben; ralf(notify)
- [ ] Tidy-up
  persona: paul
`;

let vaultDir = '';
let vault: EngineVault;

beforeEach(async () => {
  vaultDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-parts-'));
  vault = { id: 'v', name: 'vault', path: vaultDir, exists: true, active: true };
  await fsp.mkdir(path.join(vaultDir, 'tickets', '_meta'), { recursive: true });
  await fsp.writeFile(path.join(vaultDir, 'tickets', '_meta', 'pipeline.md'), PIPELINE, 'utf8');
  for (const [id, title, model] of [
    ['ben', 'Ben', 'sonnet'],
    ['paul', 'Paul', 'opus'],
    ['ralf', 'Ralf', 'opus'],
  ] as const) {
    await fsp.mkdir(path.join(vaultDir, 'tickets', '_meta', 'personas', id), { recursive: true });
    await fsp.writeFile(
      path.join(vaultDir, 'tickets', '_meta', 'personas', id, 'persona.md'),
      `---\ntitle: ${title}\nrole: builder\nworker: opencode\nmodels:\n  default: ${model}\n  pool: [${model}]\n  router: off\ncolor: '#a78bfa'\n---\n\nWho.\n`,
      'utf8',
    );
  }
});

afterEach(async () => {
  await fsp.rm(vaultDir, { recursive: true, force: true });
});

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
  const write = async (_v: string, p: string, text: string): Promise<void> => {
    await fsp.mkdir(path.dirname(abs(p)), { recursive: true });
    await fsp.writeFile(abs(p), text, 'utf8');
  };
  return {
    listVaults: async () => [vault],
    read: async (_v, p) => fsp.readFile(abs(p), 'utf8'),
    writeAnnounced: write,
    write,
    listMarkdownFiles: async () => listMarkdownFiles(vaultDir),
    resolveAssetPath: (_v, p) => abs(p),
    announceChanges: () => undefined,
    markManaged: () => undefined,
    configGet: async () => undefined,
    configSet: async () => undefined,
    emitBoardChanged: () => undefined,
    log: () => undefined,
    userRoot: '/home',
    pickFolder: async () => null,
    revealPath: async () => '',
    launchInConsole: () => undefined,
  };
}

function serviceOf(): EngineBoardService {
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
    {},
  );
}

const YOU = `---
title: You
kind: human
role: custom
worker: opencode
---

You.
`;

async function writeYou(): Promise<void> {
  await fsp.mkdir(path.join(vaultDir, 'tickets', '_meta', 'personas', 'you'), { recursive: true });
  await fsp.writeFile(path.join(vaultDir, 'tickets', '_meta', 'personas', 'you', 'persona.md'), YOU, 'utf8');
}

async function writeParent(plan = PARENT_PLAN, phase = 'inbox', chain: readonly string[] = [], at = 1): Promise<void> {
  const base = newTicketFileText({
    id: 'T-0130',
    title: 'Voice capture for tickets',
    repo: 'drey',
    priority: 'high',
    rank: 5000,
    firstPhase: phase,
    now: new Date('2026-11-02T10:00:00Z'),
    actor: 'owner@test',
    description: 'Capture by voice.',
    chain,
  });
  const text = (chain.length > 0 ? base.replace(/^at: 1$/m, `at: ${at}`) : base).replace(/\n## Plan\n[\s\S]*?\n## Log/, `${plan}\n## Log`);
  await fsp.mkdir(path.join(vaultDir, 'tickets', phase), { recursive: true });
  await fsp.writeFile(path.join(vaultDir, 'tickets', phase, 'T-0130.md'), text, 'utf8');
}

const read = (rel: string): Promise<string> => fsp.readFile(path.join(vaultDir, ...rel.split('/')), 'utf8');

/** A released ticket's file: the build directory carries the pipeline's numbering. */
async function fileOf(id: string): Promise<string> {
  const found = (await listMarkdownFiles(vaultDir)).find((f) => f.endsWith(`/${id}.md`));
  if (found === undefined) {
    throw new Error(`${id} has no file`);
  }
  return found;
}


describe('flowOf / flowEdit (ticket scope)', () => {
  it('shows the positions from the current one on, with persona, model and owner marks', async () => {
    await writeYou();
    await writeParent(PARENT_PLAN, 'build', ['paul', 'ben', 'ralf', 'you'], 2);
    const reply = await serviceOf().flowOf({ id: 'T-0130', part: null });
    expect(reply.ok).toBe(true);
    if (!reply.ok) {
      return;
    }
    expect(reply.scope).toEqual({ kind: 'ticket' });
    expect(reply.saved).toEqual(['paul', 'ben', 'ralf', 'you']);
    expect(reply.steps.map((s) => [s.index, s.position, s.persona, s.state, s.model, s.owner, s.locked])).toEqual([
      [1, 2, 'ben', 'current', 'sonnet', false, true],
      [2, 3, 'ralf', 'future', 'opus', false, false],
      [3, 4, 'you', 'future', null, true, false],
    ]);
    expect(reply.personas.map((p) => p.id)).toEqual(expect.arrayContaining(['ben', 'paul', 'ralf', 'you']));
    expect(reply.readOnly).toBeNull();
  });

  it('shows a ticket without a chain the standard flow it would get, nothing locked in the queue', async () => {
    await writeParent(PARENT_PLAN, 'inbox');
    const reply = await serviceOf().flowOf({ id: 'T-0130', part: null });
    expect(reply.ok && reply.saved).toEqual(['paul:shape', 'paul', 'ben', 'ralf']);
    expect(reply.ok && reply.steps.every((s) => s.state === 'future' && !s.locked)).toBe(true);
    expect(reply.ok && reply.steps[0]).toMatchObject({ persona: 'paul', mode: 'shape', title: 'Paul' });
  });

  it('edits a draft without writing: a persona added, reassigned and the notify rule', async () => {
    await writeParent(PARENT_PLAN, 'build', ['paul', 'ben', 'you'], 2);
    const board = serviceOf();
    const before = await read('tickets/build/T-0130.md');
    const added = await board.flowEdit({ id: 'T-0130', part: null, chain: ['paul', 'ben', 'you'], edit: { op: 'insert', persona: 'ralf', after: 1 } });
    expect(added.ok && added.chain).toEqual(['paul', 'ben', 'ralf', 'you']);
    const swapped = await board.flowEdit({ id: 'T-0130', part: null, chain: ['paul', 'ben', 'ralf', 'you'], edit: { op: 'persona', step: 2, persona: 'paul' } });
    expect(swapped.ok && swapped.chain).toEqual(['paul', 'ben', 'paul', 'you']);
    const told = await board.flowEdit({ id: 'T-0130', part: null, chain: ['paul', 'ben', 'paul', 'you'], edit: { op: 'notify', step: 2, on: true } });
    expect(told.ok && told.chain).toEqual(['paul', 'ben', 'paul(notify)', 'you']);
    expect(await read('tickets/build/T-0130.md')).toBe(before);
  });

  it('refuses a persona that does not exist, the current position and a chain that does not parse', async () => {
    await writeParent(PARENT_PLAN, 'build', ['paul', 'ben', 'you'], 2);
    const board = serviceOf();
    const chain = ['paul', 'ben', 'you'];
    expect(await board.flowEdit({ id: 'T-0130', part: null, chain, edit: { op: 'persona', step: 2, persona: 'zed' } })).toMatchObject({ ok: false });
    expect(await board.flowEdit({ id: 'T-0130', part: null, chain, edit: { op: 'remove', step: 1 } })).toMatchObject({ ok: false, error: expect.stringContaining('the current step') });
    expect(await board.flowEdit({ id: 'T-0130', part: null, chain: ['skip verify'], edit: { op: 'view' } })).toMatchObject({ ok: false, error: expect.stringContaining('not readable') });
  });

  it('save flow writes the ticket header through setChain; an empty draft is the standard flow', async () => {
    await writeParent(PARENT_PLAN, 'build', ['paul', 'ben', 'you'], 2);
    const board = serviceOf();
    expect(await board.saveFlow({ id: 'T-0130', part: null, chain: ['paul', 'ben', 'ralf(notify)', 'you'] })).toMatchObject({ ok: true });
    const text = await read('tickets/build/T-0130.md');
    expect(text).toMatch(/^ {2}- ralf\(notify\)$/m);
    expect(text).toMatch(/^at: 2$/m);
    expect(text).toContain('chain paul; ben; ralf(notify); you');
    const reread = await board.flowOf({ id: 'T-0130', part: null });
    expect(reread.ok && reread.saved).toEqual(['paul', 'ben', 'ralf(notify)', 'you']);
    expect(await board.saveFlow({ id: 'T-0130', part: null, chain: [] })).toMatchObject({ ok: false, error: expect.stringContaining('position 1 (paul) is done') });
  });
});

describe('flowOf / flowEdit / saveFlow (part scope)', () => {
  it('shows the part chain, nothing locked, and saves into the part line', async () => {
    await writeParent();
    const board = serviceOf();
    const flow = await board.flowOf({ id: 'T-0130', part: 1 });
    expect(flow.ok).toBe(true);
    if (!flow.ok) {
      return;
    }
    expect(flow.scope).toEqual({ kind: 'part', index: 1, title: 'Dictation hand-off' });
    expect(flow.saved).toEqual(['ben', 'ralf(notify)']);
    expect(flow.steps[0]).toMatchObject({ persona: 'ben', state: 'future', locked: false });

    const edited = await board.flowEdit({ id: 'T-0130', part: 1, chain: [...flow.saved], edit: { op: 'insert', persona: 'paul', after: -1 } });
    expect(edited.ok).toBe(true);
    if (!edited.ok) {
      return;
    }
    expect(await board.saveFlow({ id: 'T-0130', part: 1, chain: edited.chain })).toMatchObject({ ok: true });
    const text = await read('tickets/inbox/T-0130.md');
    expect(text).toContain('chain: paul; ben; ralf(notify)');
    // The other parts keep their text.
    expect(text).toContain('persona: paul');
    expect((await board.planParts('T-0130')).ok).toBe(true);
  });

  it('refuses a save the guard rejects, an unknown part and a part that is a ticket already', async () => {
    await writeParent();
    const board = serviceOf();
    expect(await board.saveFlow({ id: 'T-0130', part: 1, chain: ['zed'] })).toMatchObject({ ok: false, error: expect.stringContaining('does not exist') });
    expect(await board.flowOf({ id: 'T-0130', part: 9 })).toEqual({ ok: false, error: 'no such part in this plan' });
    expect((await board.releasePlan({ id: 'T-0130', scope: 'first' })).ok).toBe(true);
    const locked = await board.flowOf({ id: 'T-0130', part: 0 });
    expect(locked.ok && locked.readOnly).toContain('released as a ticket');
    expect(await board.saveFlow({ id: 'T-0130', part: 0, chain: [] })).toMatchObject({ ok: false });
  });

  it('gives a released part its own chain, and a part without one the standard flow', async () => {
    await writeParent();
    const board = serviceOf();
    expect((await board.releasePlan({ id: 'T-0130', scope: 'all' })).ok).toBe(true);
    const files = await listMarkdownFiles(vaultDir);
    const texts = await Promise.all(files.filter((f) => /T-013[1-3]\.md$/.test(f)).sort().map((f) => read(f)));
    expect(texts[0]).toContain('chain: [paul:shape, paul, ben, ralf]');
    expect(texts[1]).toContain('chain: [ben, ralf(notify)]');
  });
});

describe('flowDraftContext', () => {
  it('hands Paul the standard flow, the chain now and the crew', async () => {
    await writeParent();
    const ctx = await serviceOf().flowDraftContext({ id: 'T-0130', part: 0 });
    expect(ctx.ok).toBe(true);
    if (ctx.ok) {
      expect(ctx.text).toContain('Standard flow: paul:shape; paul; ben; ralf');
      expect(ctx.text).toContain('part "Capture window"');
      expect(ctx.text).toContain('- ralf (Ralf)');
    }
  });
});

describe('the plan\'s ### Chain and the chain at creation (req-266)', () => {
  it('copies the standard flow into a new ticket with the cursor at 1', async () => {
    const board = serviceOf();
    const created = await board.createTicket({ title: 'A new idea', priority: 'normal', repo: null, description: 'x' });
    expect(created.ok).toBe(true);
    const text = await read(await fileOf('T-0001'));
    expect(text).toContain('chain: [paul:shape, paul, ben, ralf]');
    expect(text).toMatch(/^at: 1$/m);
  });

  it('takes the plan\'s ### Chain as the ticket\'s chain when the plan is saved, and says why when it does not hold', async () => {
    await writeParent(PARENT_PLAN, 'inbox', ['paul', 'ben'], 1);
    const board = serviceOf();
    expect(await board.setPlan({ id: 'T-0130', plan: 'Goal.\n\n### Chain\n\npaul; ben; ralf(notify)\n' })).toMatchObject({ ok: true });
    expect(await read('tickets/inbox/T-0130.md')).toContain('chain paul; ben; ralf(notify)');
    const refused = await board.setPlan({ id: 'T-0130', plan: 'Goal.\n\n### Chain\n\npaul; zed\n' });
    expect(refused).toMatchObject({ ok: true, warning: expect.stringContaining('persona "zed" does not exist') });
    expect(await read('tickets/inbox/T-0130.md')).toMatch(/^ {2}- ralf\(notify\)$/m);
  });
});

describe('the human persona (E10-6)', () => {
  async function park(phase: string): Promise<void> {
    const rel = path.join(vaultDir, 'tickets', phase, 'T-0130.md');
    const text = await fsp.readFile(rel, 'utf8');
    await fsp.writeFile(
      rel,
      patchTicketFile(text, { to: phase, from: null, now: new Date('2026-11-04T10:00:00Z'), actor: 'agent@fleet', action: 'parked for You', setAwaiting: 'you' }),
      'utf8',
    );
  }

  it('lists you as a human persona', async () => {
    await writeYou();
    await writeParent(PARENT_PLAN, 'build');
    const reply = await serviceOf().flowOf({ id: 'T-0130', part: null });
    expect(reply.ok).toBe(true);
    if (reply.ok) {
      expect(reply.personas.find((p) => p.id === 'you')).toMatchObject({ kind: 'human', model: '' });
      expect(reply.personas.find((p) => p.id === 'ben')).toMatchObject({ kind: 'agent' });
    }
  });

  it('Accept finishes the manual step: the chain goes on, the park is gone, the Log names the owner', async () => {
    await writeParent(PARENT_PLAN, 'review');
    await park('review');
    const board = serviceOf();
    expect(await read('tickets/review/T-0130.md')).toMatch(/^awaiting: /m);
    expect(await board.acceptTicket({ id: 'T-0130' })).toMatchObject({ ok: true });
    const text = await read(await fileOf('T-0130'));
    expect(text).not.toMatch(/^awaiting:/m);
    expect(text).toContain('manual step finished by owner@test');
    expect(await fileOf('T-0130')).toContain('verify/T-0130.md');
  });

  it('Send back returns the ticket to the previous agent phase with the note, and the park is gone', async () => {
    await fsp.writeFile(
      path.join(vaultDir, 'tickets', '_meta', 'pipeline.md'),
      PIPELINE.replace('{ id: build, title: Build, handover: manual, persona: ben }', '{ id: build, title: Build, handover: agent build-default, persona: ben }'),
      'utf8',
    );
    await writeParent(PARENT_PLAN, 'review');
    await park('review');
    const board = serviceOf();
    expect(await board.sendBack({ id: 'T-0130', note: 'The spacing is off' })).toMatchObject({ ok: true });
    const text = await read(await fileOf('T-0130'));
    expect(text).not.toMatch(/^awaiting:/m);
    expect(text).toContain('sent back: The spacing is off');
    expect(await fileOf('T-0130')).toContain('build/T-0130.md');
  });

  it('the first flow read creates personas/you once, and a plain refresh leaves the vault alone', async () => {
    await writeParent(PARENT_PLAN, 'build');
    const board = serviceOf();
    await board.refresh();
    expect(await listMarkdownFiles(vaultDir)).not.toContain('tickets/_meta/personas/you/persona.md');
    await board.flowOf({ id: 'T-0130', part: null });
    const path1 = 'tickets/_meta/personas/you/persona.md';
    const created = await read(path1);
    expect(created).toContain('kind: human');
    expect(created).toContain('title: You');
    await fsp.writeFile(path.join(vaultDir, ...path1.split('/')), created.replace('title: You', 'title: Henrik'), 'utf8');
    await board.flowOf({ id: 'T-0130', part: null });
    expect(await read(path1)).toContain('title: Henrik');
    const personas = await board.listPersonas();
    expect(personas.find((p) => p.id === 'you')).toMatchObject({ kind: 'human', title: 'Henrik' });
  });
});
