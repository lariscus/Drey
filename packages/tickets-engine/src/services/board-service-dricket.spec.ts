import { execFile, execFileSync } from 'node:child_process';
import { promises as fsp, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EngineBoardService } from './board-service';
import type { EngineHost, EngineVault, FleetPort } from './host';
import { writeLifecycleStages } from './lifecycle-store.fake';
import { TicketsGit } from '../core/git/tickets-git';
import { normalizeFleetCaps, normalizeFleetHandover, normalizeFleetPools, type ChainConfig, type RunRequest } from '../fleet/protocol';
import { assertDkVersion, MIN_DK_VERSION } from '../store/dk-process';
import { toDricketId } from '../store/ids';
import { openStatusItems } from '../core/pipeline/status-log';
import { isLifecycleStore, parseStoreStages } from '../store/store-stages';
import { NOT_LIFECYCLE_STORE } from './board-service';
import { defaultStorePathOf } from '../store/fresh-store';
import { readStoreRef, withStoreRef } from '../core/pipeline/pipeline-store';

/**
 * E14-4b: the board's write moves against a REAL `dk` and a SCRATCH store —
 * capture, header edits, the raw save with its conflict, moves (transition,
 * accept = archive, send back, unarchive), the parts release (children first,
 * parent last, resumable) and the refusals of the fleet's own writes. The meta
 * vault (pipeline, personas) is a temp folder; nothing of the owner's repos or
 * store is touched. Skipped, with the reason, when `dk` is missing or too old.
 */
const bin = process.env['DREY_DK_BIN'] ?? 'dk';

function probe(): { ok: true } | { ok: false; reason: string } {
  try {
    const out = execFileSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true });
    assertDkVersion(/version:\s*(\S+)/.exec(out)?.[1] ?? out.trim(), bin);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : `dk was not found ("${bin}"); set DREY_DK_BIN to a dk >= ${MIN_DK_VERSION}` };
  }
}
const found = probe();
if (!found.ok) {
  console.warn(`[board service dricket] SKIPPED: ${found.reason}`);
}

const PIPELINE = `---
phases:
  - { id: inbox, title: Inbox, handover: manual }
  - { id: prioritized, title: Prioritized, handover: manual }
  - { id: done, title: Done, handover: none }
flow: ben; you
priorities: [urgent, high, normal, low]
---
The pipeline.
`;

const PLAN = `Goal text.

### Parts

- [ ] Capture window
  persona: ben
- [ ] Dictation hand-off
  chain: skip commit; notify build
- [ ] Tidy-up
  persona: paul
`;

describe.skipIf(!found.ok)('the board service writing through dk', { timeout: 240_000 }, () => {
  let root = '';
  let storeDir = '';
  let vaultDir = '';
  let vault: EngineVault;
  let service: EngineBoardService;
  const saved: Record<string, string | undefined> = {};
  const ledgerWrites: string[] = [];
  const chainConfigs: ChainConfig[] = [];
  const envSet = (key: string, value: string): void => {
    if (!(key in saved)) {
      saved[key] = process.env[key];
    }
    process.env[key] = value;
  };
  const dk = (args: string[]): string => execFileSync(bin, args, { windowsHide: true, encoding: 'utf8', stdio: 'pipe' });
  const dkShow = (id: string): string => (JSON.parse(dk(['show', id, '--json'])) as { data: { content: string } }).data.content;
  const field = (id: string, key: string): string => new RegExp(`^${key}: (.*)$`, 'm').exec(dkShow(id))?.[1]?.trim() ?? '';

  const abs = (p: string): string => path.join(vaultDir, ...p.split('/'));
  const config: Record<string, string> = {};

  function hostOf(): EngineHost {
    const write = async (_v: string, p: string, text: string): Promise<void> => {
      await fsp.mkdir(path.dirname(abs(p)), { recursive: true });
      await fsp.writeFile(abs(p), text, 'utf8');
    };
    const list = async (dir = ''): Promise<string[]> => {
      const out: string[] = [];
      for (const entry of await fsp.readdir(dir === '' ? vaultDir : abs(dir), { withFileTypes: true }).catch(() => [])) {
        const rel = dir === '' ? entry.name : `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          out.push(...(await list(rel)));
        } else if (entry.name.endsWith('.md')) {
          out.push(rel);
        }
      }
      return out;
    };
    return {
      listVaults: async () => [vault],
      read: async (_v, p) => fsp.readFile(abs(p), 'utf8'),
      writeAnnounced: write,
      write,
      listMarkdownFiles: () => list(),
      resolveAssetPath: (_v, p) => abs(p),
      announceChanges: () => undefined,
      markManaged: () => undefined,
      configGet: async <T>(key: string) => config[key] as T | undefined,
      configSet: async () => undefined,
      emitBoardChanged: () => undefined,
      log: () => undefined,
      pickFolder: async () => null,
      revealPath: async () => '',
      launchInConsole: () => undefined,
    };
  }

  beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'drey-board-dk-'));
    const home = path.join(root, 'home');
    mkdirSync(home);
    storeDir = path.join(root, 'store');
    for (const [k, v] of Object.entries({
      HOME: home,
      USERPROFILE: home,
      APPDATA: path.join(home, 'AppData'),
      LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
      XDG_CONFIG_HOME: path.join(home, '.config'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Board Test',
      GIT_AUTHOR_EMAIL: 'board@test.invalid',
      GIT_COMMITTER_NAME: 'Board Test',
      GIT_COMMITTER_EMAIL: 'board@test.invalid',
      DK_DATA_DIR: path.join(root, 'data'),
      DK_OWNER: 'owner@scratch',
    })) {
      envSet(k, v);
    }
    dk(['init', storeDir, 't']);
    writeLifecycleStages(storeDir);
    envSet('DK_STORE', storeDir);

    vaultDir = path.join(root, 'meta');
    vault = { id: 'v', name: 'vault', path: vaultDir, exists: true, active: true };
    await fsp.mkdir(abs('tickets/_meta'), { recursive: true });
    await fsp.writeFile(abs('tickets/_meta/pipeline.md'), PIPELINE, 'utf8');
    for (const [id, model] of [['ben', 'sonnet'], ['paul', 'opus']] as const) {
      await fsp.mkdir(abs(`tickets/_meta/personas/${id}`), { recursive: true });
      await fsp.writeFile(
        abs(`tickets/_meta/personas/${id}/persona.md`),
        `---\ntitle: ${id}\nrole: builder\nworker: opencode\nmodels:\n  default: ${model}\n  pool: [${model}]\n  router: off\ncolor: '#a78bfa'\n---\n\nWho.\n`,
        'utf8',
      );
    }
    await fsp.mkdir(abs('tickets/_meta/personas/you'), { recursive: true });
    await fsp.writeFile(abs('tickets/_meta/personas/you/persona.md'), '---\ntitle: You\nkind: human\nrole: custom\n---\n', 'utf8');
    Object.assign(config, { 'dk.path': bin === 'dk' ? '' : bin, 'dk.store': storeDir, 'dk.dataDir': path.join(root, 'data') });
    const git2 = new TicketsGit(() => 'git', async () => {
      throw new Error('no git in the spec');
    });
    const fleet: FleetPort = { runs: async () => [], start: async () => ({ ok: false, error: 'not in the spec' }), configureChain: async (c) => { chainConfigs.push(c); } };
    service = new EngineBoardService(hostOf(), git2, 'opencode', 'accept-edits', '', fleet, '/fleet', normalizeFleetCaps({}), normalizeFleetPools({}), normalizeFleetHandover({}), 'owner@test', { events: { ledger: (write) => ledgerWrites.push(write.kind) } });
  }, 120_000);

  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    service?.dispose();
    await service?.idle();
    rmSync(root, { recursive: true, force: true });
  });

  const phaseOf = async (id: string): Promise<string | null> => {
    const board = await service.snapshot();
    return board.columns.find((c) => c.tickets.some((t) => t.id === id))?.phase.id ?? null;
  };
  const rev = (id: string): number => Number(field(id, 'rev'));

  it('the machine-wide dk.store moves into the pipeline on the first read (req-315)', async () => {
    expect(readStoreRef(await fsp.readFile(abs('tickets/_meta/pipeline.md'), 'utf8'))).toBeNull();
    const board = await service.snapshot();
    expect(readStoreRef(await fsp.readFile(abs('tickets/_meta/pipeline.md'), 'utf8'))).toBe(storeDir);
    expect(board.issues.map((issue) => issue.message).join('\n')).not.toContain('dricket store');
  });

  it('captures a ticket: dk allocates the number, one put fills the document', async () => {
    const reply = await service.createTicket({ title: 'Voice: capture', priority: 'high', repo: null, description: 'Capture by voice.' });
    expect(reply).toMatchObject({ ok: true, id: 'T-0001' });
    expect(field('t-1', 'stage')).toBe('inbox');
    expect(field('t-1', 'priority')).toBe('high');
    expect(dkShow('t-1')).toContain('Capture by voice.');
    expect(rev('t-1')).toBe(1);
    expect(await phaseOf('T-0001')).toBe('inbox');
  });

  it('edits the header and the body through put, one commit each, rev + 1', async () => {
    expect(await service.setPriority({ id: 'T-0001', priority: 'urgent' })).toMatchObject({ ok: true });
    expect(field('t-1', 'priority')).toBe('urgent');
    expect(rev('t-1')).toBe(2);
    expect(await service.setTrack({ id: 'T-0001', track: 'shape' })).toMatchObject({ ok: true });
    expect(field('t-1', 'x-track')).toBe('shape');
    expect(await service.setBlockedBy({ id: 'T-0001', blockedBy: [] })).toMatchObject({ ok: true });
    expect(await service.setPlan({ id: 'T-0001', plan: PLAN })).toMatchObject({ ok: true });
    expect(dkShow('t-1')).toContain('### Parts');
    expect(rev('t-1')).toBe(4);
  });

  it('refuses a raw save made on a stale text, and reports a ticket that moved on (exit 12) as a conflict', async () => {
    const read = await service.readTicket('T-0001');
    expect(read.ok).toBe(true);
    if (!read.ok) {
      return;
    }
    expect(await service.setPriority({ id: 'T-0001', priority: 'high' })).toMatchObject({ ok: true });
    const stale = await service.saveTicket({ id: 'T-0001', text: read.text, baseRevision: read.revision });
    expect(stale).toMatchObject({ ok: false, conflict: true });

    const fresh = await service.readTicket('T-0001');
    if (!fresh.ok) {
      throw new Error('read failed');
    }
    // A foreign write lands between the service's read and its put: dk answers exit 12.
    const before = rev('t-1');
    const source = (service as unknown as { storeBoard: { writeLegacy: (...a: unknown[]) => Promise<unknown> } }).storeBoard;
    const original = source.writeLegacy.bind(source);
    const spy = vi.spyOn(source, 'writeLegacy').mockImplementationOnce(async (...args: unknown[]) => {
      dk(['put', 't-1', '-F', writeTemp(dkShow('t-1').replace('priority: high', 'priority: low')), '--claim', '--if-version', String(before)]);
      return original(...args);
    });
    const raced = await service.saveTicket({ id: 'T-0001', text: fresh.text.replace('Capture by voice.', 'Changed.'), baseRevision: fresh.revision });
    spy.mockRestore();
    expect(raced).toMatchObject({ ok: false, conflict: true });
    expect(dkShow('t-1')).not.toContain('Changed.');
    expect(field('t-1', 'priority')).toBe('low');
    await service.setPriority({ id: 'T-0001', priority: 'high' });
  });

  it('saves a ticket document from the editor through put (E14-4c): rev from the text, exit 12 is a conflict, force re-bases', async () => {
    const location = await service.ticketDocument({ id: 'T-0001' });
    expect(location).toEqual({ checkout: storeDir, path: 'tickets/t/0000/t-1/ticket.md' });
    const onDisk = (): string => readFileSync(path.join(storeDir, ...location!.path.split('/')), 'utf8');
    const first = onDisk();
    const before = rev('t-1');

    const saved = await service.saveDocument({ path: location!.path, text: first.replace('Capture by voice.', 'Capture by voice, edited.') });
    expect(saved).toMatchObject({ ok: true, rev: before + 1 });
    expect(dkShow('t-1')).toContain('Capture by voice, edited.');
    expect(onDisk()).toContain('Capture by voice, edited.');

    // The tab still holds the text of `before`: the ticket moved on, nothing is written.
    const stale = await service.saveDocument({ path: location!.path, text: first.replace('Capture by voice.', 'Lost edit.') });
    expect(stale).toMatchObject({ ok: false, conflict: { rev: before + 1 } });
    expect((stale as { conflict: { text: string } }).conflict.text).toContain('Capture by voice, edited.');
    expect(dkShow('t-1')).not.toContain('Lost edit.');
    expect(rev('t-1')).toBe(before + 1);

    // The merge was resolved against the stored document: force puts on the rev dk has now.
    const forced = await service.saveDocument({ path: location!.path, text: onDisk().replace('edited.', 'merged.'), force: true });
    expect(forced).toMatchObject({ ok: true, rev: before + 2 });
    expect(dkShow('t-1')).toContain('Capture by voice, merged.');

    expect(await service.saveDocument({ path: 'tickets/t/0000/t-1/comments/x.md', text: 'x' })).toMatchObject({ ok: false });
    expect(await service.ticketDocument({ id: 'T-0999' })).toBeNull();
  });

  it('moves a card, accepts it into the terminal column and archives it; unarchive brings it back', async () => {
    expect(await service.transition({ id: 'T-0001', from: 'inbox', to: 'prioritized' })).toMatchObject({ ok: true });
    expect(field('t-1', 'stage')).toBe('prioritized');
    expect(field('t-1', 'x-entered-prioritized')).not.toBe('');
    expect(dkShow('t-1')).toContain('inbox -> prioritized');
    expect(await phaseOf('T-0001')).toBe('prioritized');

    // A ticket in a column of its own has no earlier agent position to go back to.
    expect(await service.sendBack({ id: 'T-0001', note: 'tests missing' })).toMatchObject({ ok: false, error: 'there is no agent phase before "prioritized" to send T-0001 back to' });
    expect(field('t-1', 'stage')).toBe('prioritized');

    expect(await service.transition({ id: 'T-0001', from: 'prioritized', to: 'done' })).toMatchObject({ ok: true });
    expect(await service.acceptTicket({ id: 'T-0001' })).toMatchObject({ ok: true });
    expect(field('t-1', 'labels')).toContain('archived');
    expect(field('t-1', 'stage')).toBe('done');
    expect(await phaseOf('T-0001')).toBeNull();
    // D-7a: an accepted (archived) ticket is no card on the board, yet the chat reads it by id.
    expect(await service.readAnyTicket('T-0001')).toMatchObject({ ok: true, text: expect.stringContaining('T-0001') });
    expect(await service.readAnyTicket('T-0999')).toMatchObject({ ok: false });

    // E13-21: an archived ticket still opens (document, card), is listed under Show older
    // and counts for Done this week.
    const archived = await service.readTicket('T-0001');
    expect(archived).toMatchObject({ ok: true, card: { id: 'T-0001', phase: 'archive' } });
    expect(archived.ok && archived.text).toContain('T-0001');
    expect(await service.archivedTickets()).toMatchObject({ ok: true, tickets: [{ id: 'T-0001' }] });
    expect(await service.archivedTickets({ query: 'no-such-word' })).toEqual({ ok: true, tickets: [] });
    expect((await service.snapshot()).recentDone.map((d) => d.id)).toEqual(['T-0001']);
    expect(await service.readTicket('T-0999')).toMatchObject({ ok: false });

    expect(await service.unarchive({ id: 'T-0001', to: 'inbox' })).toMatchObject({ ok: true });
    expect(field('t-1', 'labels')).not.toContain('archived');
    expect(await phaseOf('T-0001')).toBe('inbox');
  });

  it('releases the parts children first, parent last, and resumes after a break', async () => {
    const first = await service.releasePlan({ id: 'T-0001', scope: 'first' });
    expect(first).toMatchObject({ ok: true, tickets: ['T-0002'] });
    expect(field('t-2', 'parent')).toBe('t-1');
    expect(field('t-2', 'stage')).toBe('prioritized'); // the build queue is the pipeline's second column
    expect(field('t-2', 'x-persona')).toBe('ben');
    expect(dkShow('t-1')).toContain('plan released');

    // A release that broke between add and put leaves a titled stub: the next approval fills it.
    dk(['add', '--unclaimed', '-m', 'Dictation hand-off', '--parent', 't-1', '--depends', 't-2']);
    expect(dkShow('t-3')).toContain('(no description)');
    const rest = await service.releasePlan({ id: 'T-0001', scope: 'all' });
    expect(rest).toMatchObject({ ok: true, tickets: ['T-0003', 'T-0004'] });
    expect(dkShow('t-3')).not.toContain('(no description)');
    expect(field('t-3', 'stage')).toBe('prioritized');
    expect(field('t-3', 'depends')).toBe('t-2');
    expect(field('t-4', 'depends')).toBe('t-3');
    expect(field('t-4', 'x-persona')).toBe('paul');
    expect(await service.releasePlan({ id: 'T-0001', scope: 'all' })).toMatchObject({ ok: false });
  });

  it('takes a claim and gives it back through dk (E14-5): dk alone decides', async () => {
    expect(await service.setClaim({ id: 'T-0002', mode: 'takeover', actor: 'henrik' })).toMatchObject({ ok: true });
    expect(field('t-2', 'owner')).toBe('henrik');
    // A second human cannot take over a live lease: dk's exit 11 is the answer, not a TypeScript rule.
    expect(await service.setClaim({ id: 'T-0002', mode: 'takeover', actor: 'ben' })).toMatchObject({ ok: false, error: expect.stringContaining('claimed') });
    expect(await service.setClaim({ id: 'T-0002', mode: 'release', actor: 'henrik' })).toMatchObject({ ok: true });
    expect(field('t-2', 'owner')).toBe('');
  });

  it('starts a run on a dricket ticket: the request carries the store, the runner claims (E14-5)', async () => {
    const kt = abs('kt').split(path.sep).join('/');
    await fsp.writeFile(abs('tickets/_meta/repos.md'), `---\nrepos:\n  kt:\n    url: https://example.test/kt.git\n    path: '${kt}'\n---\n`, 'utf8');
    const text = dkShow('t-2')
      .replace(/^repos:.*/m, 'repos: kt')
      .replace('## Log', '## Plan\n\n### Acceptance criteria\n\n- [ ] `echo ok`\n\n## Log');
    dk(['put', 't-2', '-F', writeTemp(text), '--claim', '--if-version', String(rev('t-2'))]);
    const started: RunRequest[] = [];
    const fleet: FleetPort = {
      runs: async () => [],
      start: async (request) => {
        started.push(request);
        return { ok: false, error: 'stub: not spawning' };
      },
      configureChain: async () => undefined,
    };
    const runner = new EngineBoardService(hostOf(), new TicketsGit(() => 'git', async () => ''), 'opencode', 'accept-edits', '', fleet, '/fleet', normalizeFleetCaps({}), normalizeFleetPools({}), normalizeFleetHandover({}), 'owner@test', {});
    try {
      const reply = await runner.startRun({ origin: 'spec', ticketId: 'T-0002', workerChoice: null, permissionMode: 'accept-edits', handover: null, interactive: null });
      expect(reply).toMatchObject({ ok: false, error: 'stub: not spawning' });
      expect(started).toHaveLength(1);
      expect(started[0]!.dk).toMatchObject({ store: storeDir, trailers: false, parkStage: null });
      expect(started[0]!.ticketId).toBe('T-0002');
      expect(started[0]!.origin).toBe('spec'); // D-41: who asked rides to the runner

      // D-41: a start nobody names is refused here, whichever route it came by.
      const nameless = { ticketId: 'T-0002', workerChoice: null, permissionMode: 'accept-edits', handover: null, interactive: null } as const;
      expect(await runner.startRun({ ...nameless, origin: ' ' })).toMatchObject({ ok: false, error: expect.stringContaining('origin') });
      expect(await runner.startRun(nameless as unknown as Parameters<typeof runner.startRun>[0])).toMatchObject({ ok: false, error: expect.stringContaining('origin') });
      expect(started).toHaveLength(1);
    } finally {
      runner.dispose();
    }
  });

  it("an owner's start carries the persona's skills like a dispatch does (D-46)", async () => {
    const kt = abs('kt').split(path.sep).join('/');
    await fsp.writeFile(abs('tickets/_meta/repos.md'), `---\nrepos:\n  kt:\n    url: https://example.test/kt.git\n    path: '${kt}'\n---\n`, 'utf8');
    const text = dkShow('t-2')
      .replace(/^repos:.*/m, 'repos: kt')
      .replace('## Log', '## Plan\n\n### Acceptance criteria\n\n- [ ] `echo ok`\n\n## Log');
    dk(['put', 't-2', '-F', writeTemp(text), '--claim', '--if-version', String(rev('t-2'))]);
    // the persona that works the ticket is the one its part pinned (`x-persona: ben`, the release above)
    const ben = abs('tickets/_meta/personas/ben');
    await fsp.mkdir(path.join(ben, 'skills'), { recursive: true });
    await fsp.writeFile(
      path.join(ben, 'persona.md'),
      "---\ntitle: Pia\nrole: builder\nworker: opencode\nmodels:\n  default: m\n  pool: [m]\n  router: off\ncolor: '#a78bfa'\nskills: [own]\n---\n",
      'utf8',
    );
    await fsp.writeFile(path.join(ben, 'skills', 'own.md'), 'Own skill text.\n', 'utf8');
    const started: RunRequest[] = [];
    const fleet: FleetPort = {
      runs: async () => [],
      start: async (request) => {
        started.push(request);
        return { ok: false, error: 'stub: not spawning' };
      },
      configureChain: async () => undefined,
    };
    const runner = new EngineBoardService(hostOf(), new TicketsGit(() => 'git', async () => ''), 'opencode', 'accept-edits', '', fleet, '/fleet', normalizeFleetCaps({}), normalizeFleetPools({}), normalizeFleetHandover({}), 'owner@test', {});
    try {
      await runner.startRun({ origin: 'spec', ticketId: 'T-0002', workerChoice: null, permissionMode: 'accept-edits', handover: null, interactive: null });
      expect(started[0]!.instruction).toContain('### own\n\nOwn skill text.');
    } finally {
      runner.dispose();
    }
  });

  it("a client asking for a run from an owner's column is refused before the runner hears of it (D-29)", async () => {
    const created = await service.createTicket({ title: 'Stays put', priority: 'normal', repo: null, description: 'Body.' });
    const id = (created as unknown as { id: string }).id;
    const started: RunRequest[] = [];
    const fleet: FleetPort = {
      runs: async () => [],
      start: async (request) => {
        started.push(request);
        return { ok: false, error: 'stub: not spawning' };
      },
      configureChain: async () => undefined,
    };
    const runner = new EngineBoardService(hostOf(), new TicketsGit(() => 'git', async () => ''), 'opencode', 'accept-edits', '', fleet, '/fleet', normalizeFleetCaps({}), normalizeFleetPools({}), normalizeFleetHandover({}), 'owner@test', {});
    try {
      const reply = await runner.startRun({ origin: 'spec', ticketId: id, workerChoice: 'opencode', permissionMode: 'accept-edits', handover: 'fresh', interactive: null });
      expect(reply).toMatchObject({ ok: false, error: expect.stringContaining("the owner's column") });
      expect(started).toEqual([]);
    } finally {
      runner.dispose();
    }
  });

  it('keeps notes and signals as comments, answers a decision, and writes no phase ledger line or status file (E14-6)', async () => {
    const created = await service.createTicket({ title: 'Signals', priority: 'normal', repo: null, description: 'Signal body.' });
    expect(created).toMatchObject({ ok: true });
    const id = (created as unknown as { id: string }).id;
    const dkId = toDricketId(id)!;
    ledgerWrites.length = 0;
    expect(await service.transition({ id, from: 'inbox', to: 'prioritized' })).toMatchObject({ ok: true });
    // The ticket goes on as a chain ticket at You's entry (the owner's sign-off position).
    const header = dkShow(dkId).replace(/^x-(chain|at): .*\n/gm, '').replace(/^stage: .*$/m, 'stage: active\nx-chain: ben;you\nx-at: 2');
    dk(['put', dkId, '-F', writeTemp(header), '--claim', '--if-version', String(rev(dkId))]);
    expect(ledgerWrites).not.toContain('phase');

    // The send-back note, whole, is a comment.
    const note = 'tests are missing for the empty case, and the button still misaligns';
    expect(await service.sendBack({ id, note })).toMatchObject({ ok: true });
    const afterSend = await service.ticketComments(id);
    // The cursor's own status line (a chain move) sits beside the note; the note itself is one whole, plain comment.
    expect(afterSend.map((c) => c.text)).toHaveLength(2);
    expect(afterSend.map((c) => c.text)).toContain(`sent back: ${note}`);
    expect(afterSend.find((c) => c.text === `sent back: ${note}`)!.verb).toBeNull();
    expect(afterSend.map((c) => c.text)).toContain(`done: sent back to position 1 (ben): ${note}`);

    // A decision asked as a keyed comment shows in the status read and the ticket view; working is not persisted.
    dk(['comment', dkId, '-m', 'needs-decision: [palette] Which shortcut should open the palette?']);
    const lines = await service.statusOf(id);
    expect(openStatusItems(lines).map((i) => [i.verb, i.key])).toEqual([['needs-decision', 'palette']]);
    const view = await service.readTicket(id);
    // dk orders comment files by second then author, so comments of one second come in either order.
    expect(view.ok && view.comments?.map((c) => c.verb)).toHaveLength(3);
    expect(view.ok && view.comments?.map((c) => c.verb)).toEqual(expect.arrayContaining([null, 'needs-decision']));

    // The answer closes the key (the only open one is the default) and carries the text.
    expect(await service.answerNeed({ id, text: 'Ctrl+K' })).toEqual({ ok: true });
    expect(openStatusItems(await service.statusOf(id))).toEqual([]);
    const thread = await service.ticketComments(id);
    expect(thread[thread.length - 1]).toMatchObject({ verb: 'resolved', key: 'palette' });
    expect(thread[thread.length - 1]!.text).toBe('resolved: palette\n\nCtrl+K');
    expect(await service.answerNeed({ id, key: 'palette' })).toMatchObject({ ok: false });
    expect(await service.answerNeed({ id, key: 'no-such-key', text: 'x' })).toMatchObject({ ok: false });

    // The ticket file itself carries none of it; no status file landed in the meta vault.
    expect(dkShow(dkId)).not.toContain('Ctrl+K');
    expect(await fsp.readdir(abs('tickets')).then((names) => names.filter((n) => n !== '_meta'))).toEqual([]);
  });

  it('lets the chain run on a store with a checkout and refuses one without (E14-5b)', async () => {
    expect(await service.chainRefusal()).toBeNull(); // a local store directory is its own checkout
    await service.snapshot(); // the chain follows the pipeline: its config now names the store, not ticket files
    expect(chainConfigs.at(-1)?.store).toMatchObject({ dkStore: storeDir, dkDataDir: path.join(root, 'data'), trailers: false });
    expect(chainConfigs.at(-1)?.ticketsVaultPath).toBe(vaultDir);
    // req-315: the project names its store in the pipeline — a remote one for this scenario.
    await fsp.writeFile(abs('tickets/_meta/pipeline.md'), withStoreRef(PIPELINE, 'https://example.invalid/t.git#tickets'), 'utf8');
    expect(await service.chainRefusal()).toContain('checkout');
    config['dk.checkout'] = path.join(root, 'checkout');
    expect(await service.chainRefusal()).toBeNull();
    delete config['dk.checkout'];
    // Back to the local store: the pipeline loses the reference, the first
    // read re-anchors the machine-wide override (req-315's migration).
    await fsp.writeFile(abs('tickets/_meta/pipeline.md'), PIPELINE, 'utf8');
    await service.snapshot();
    expect(readStoreRef(await fsp.readFile(abs('tickets/_meta/pipeline.md'), 'utf8'))).toBe(config['dk.store'] ?? null);
  });

  /** A fresh, boardless vault with its own config store — the D-74/req-315 harness. */
  function freshHarness(name: string, config: Record<string, string | undefined>): {
    fresh: EngineBoardService;
    dir: string;
    storeDir: string;
    fAbs(p: string): string;
  } {
    const dir = path.join(root, name);
    const freshVault: EngineVault = { id: name, name, path: dir, exists: true, active: true };
    const storeDir = defaultStorePathOf(dir);
    const fAbs = (p: string): string => path.join(dir, ...p.split('/'));
    const fleet: FleetPort = { runs: async () => [], start: async () => ({ ok: false, error: 'not in the spec' }), configureChain: async () => undefined };
    const storeGit = new TicketsGit(() => 'git', async (_exe, args, cwd) => {
      if (!cwd.startsWith(root)) {
        throw new Error('no git in the spec'); // the fresh vault's own history stays untouched
      }
      const { stdout } = await promisify(execFile)('git', ['-c', 'core.quotepath=false', '--literal-pathspecs', ...args], {
        cwd,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      });
      return stdout;
    });
    const fresh = new EngineBoardService(
      {
        listVaults: async () => [freshVault],
        read: async (_v, p) => fsp.readFile(fAbs(p), 'utf8'),
        writeAnnounced: async (_v, p, text) => {
          await fsp.mkdir(path.dirname(fAbs(p)), { recursive: true });
          await fsp.writeFile(fAbs(p), text, 'utf8');
        },
        write: async (_v, p, text) => {
          await fsp.mkdir(path.dirname(fAbs(p)), { recursive: true });
          await fsp.writeFile(fAbs(p), text, 'utf8');
        },
        listMarkdownFiles: () => Promise.resolve([]),
        resolveAssetPath: (_v, p) => fAbs(p),
        announceChanges: () => undefined,
        markManaged: () => undefined,
        configGet: async <T>(key: string) => config[key] as T | undefined,
        configSet: async (key, value) => {
          config[key] = value as string;
        },
        emitBoardChanged: () => undefined,
        log: () => undefined,
        pickFolder: async () => null,
        revealPath: async () => '',
        launchInConsole: () => undefined,
      },
      storeGit,
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
    return { fresh, dir, storeDir, fAbs };
  }

  async function disposeFresh(fresh: EngineBoardService, dirs: readonly string[]): Promise<void> {
    await fresh.dispose();
    await fresh.idle();
    for (const dir of dirs) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  it('a fresh install: "Initialize board" anchors its own store in the pipeline (E14-9b, req-315)', async () => {
    const config: Record<string, string | undefined> = {
      'dk.path': bin === 'dk' ? '' : bin,
      'dk.dataDir': path.join(root, 'data'),
    };
    const { fresh, dir, storeDir: storeDir2, fAbs } = freshHarness('meta-fresh', config);
    try {
      // D-74: the engine hosts the vault BEFORE a board exists — the setup
      // starts the service against this honest null board, then initializes.
      const before = await fresh.snapshot();
      expect(before.vaultId).toBeNull();
      expect(before.vaultPath).toBeUndefined();
      expect(await fresh.initialize('fresh')).toMatchObject({ ok: true });
      // req-315: the store is anchored in the project's pipeline — the
      // machine-wide key is never written for it.
      expect(readStoreRef(await fsp.readFile(fAbs('tickets/_meta/pipeline.md'), 'utf8'))).toBe(storeDir2);
      expect(config['dk.store']).toBeUndefined();
      // The toml lives on the store's main branch; the working copy is the tickets branch.
      const toml = (await promisify(execFile)('git', ['show', 'main:dricket.toml'], { cwd: storeDir2, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })).stdout;
      expect(isLifecycleStore(parseStoreStages(toml))).toBe(true);
      // The board reads its new store: neither the unconfigured nor the wrong-stages error stands.
      const messages = (await fresh.snapshot()).issues.map((issue) => issue.message).join('\n');
      expect(messages).not.toContain('no dricket store configured');
      expect(messages).not.toContain(NOT_LIFECYCLE_STORE);
    } finally {
      await disposeFresh(fresh, [dir, storeDir2]);
    }
  });

  it('a fresh vault never adopts another project\'s store (req-315)', async () => {
    const foreign = path.join(root, 'another-projects-store'); // not even existing
    const { fresh, dir, storeDir: storeDir2, fAbs } = freshHarness('meta-fresh2', {
      'dk.path': bin === 'dk' ? '' : bin,
      'dk.dataDir': path.join(root, 'data'),
      'dk.store': foreign,
    });
    try {
      expect(await fresh.initialize('fresh2')).toMatchObject({ ok: true });
      // the project's own store beside the vault, anchored in its pipeline;
      // the machine-wide key names the other project's store and stays untouched
      expect(readStoreRef(await fsp.readFile(fAbs('tickets/_meta/pipeline.md'), 'utf8'))).toBe(storeDir2);
      // the board reads its own (empty) store, not the foreign one — a foreign
      // store path would answer unreadable and stand in the issues
      const board = await fresh.snapshot();
      expect(board.issues.map((issue) => issue.message).join('\n')).not.toContain('dricket store');
      expect(board.columns.reduce((count, column) => count + column.tickets.length, 0)).toBe(0);
    } finally {
      await disposeFresh(fresh, [dir, storeDir2]);
    }
  });


  function writeTemp(text: string): string {
    const file = path.join(root, `put-${Date.now()}.md`);
    writeFileSync(file, text, 'utf8');
    return file;
  }
});
