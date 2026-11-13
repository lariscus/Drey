import { execFileSync } from 'node:child_process';
import { promises as fsp, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_PIPELINE_TEXT } from '../core/pipeline-states';
import { TicketsGit } from '../core/tickets-git';
import { normalizeFleetCaps, normalizeFleetHandover, normalizeFleetPools, type RunInfo, type RunRequest } from '../fleet/protocol';
import { assertDkVersion, MIN_DK_VERSION } from '../store/dk-process';
import { EngineBoardService } from './board-service';
import type { EngineHost, EngineVault, FleetPort } from './host';

/**
 * req-257 over a REAL dk store on the lifecycle stages: the column of an
 * `active` chain ticket follows its holder; the owner's Accept moves the
 * cursor (the last You entry is the sign-off's commit), Send back moves it
 * to the nearest earlier agent position, an owner's move into a working
 * column moves it there, and a chain an agent finished lands in `done`.
 * Skipped, with the reason, when `dk` is missing.
 */

const bin = process.env['DREY_DK_BIN'] ?? 'dk';
const PERSONA = (kind: string, extra = ''): string => `---\ntitle: P\nkind: ${kind}\nrole: custom\nworker: opencode\n${extra}---\n`;

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
  console.warn(`[chain on a lifecycle store] SKIPPED: ${found.reason}`);
}

function runInfo(id: string, ticketId: string, state: RunInfo['state']): RunInfo {
  return { id, ticketId, provider: 'opencode', state, pid: null, startedAt: '2026-11-12T10:00:00Z', endedAt: null, sessionRef: null, tokensIn: 0, tokensOut: 0, costUsd: null, lastActivity: '2026-11-12T10:00:00Z' } as RunInfo;
}

function hostOver(vaultDir: string, vault: EngineVault, config: Record<string, string>): EngineHost {
  const abs = (p: string): string => path.join(vaultDir, ...p.split('/'));
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
    userRoot: path.join(vaultDir, 'userroot'),
    pickFolder: async () => null,
    revealPath: async () => '',
    launchInConsole: () => undefined,
  };
}

describe.skipIf(!found.ok)('the chain on a lifecycle store (req-257, real dk)', { timeout: 240_000 }, () => {
  let root = '';
  let storeDir = '';
  let service: EngineBoardService;
  const saved: Record<string, string | undefined> = {};
  const started: RunRequest[] = [];

  const envSet = (key: string, value: string): void => {
    if (!(key in saved)) {
      saved[key] = process.env[key];
    }
    process.env[key] = value;
  };
  const dk = (args: string[]): string => execFileSync(bin, args, { windowsHide: true, encoding: 'utf8', stdio: 'pipe' });
  const content = (id: string): string => (JSON.parse(dk(['show', id, '--json'])) as { data: { content: string } }).data.content;
  const field = (id: string, key: string): string | null => new RegExp(`^${key}: (.*)$`, 'm').exec(content(id))?.[1]?.trim() ?? null;

  beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'drey-chain-dk-'));
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
      DK_OWNER: 'owner@test',
    })) {
      envSet(k, v);
    }
    dk(['init', storeDir, 't']);
    const git = (args: string[]): void => {
      execFileSync('git', args, { cwd: storeDir, windowsHide: true, stdio: 'pipe' });
    };
    git(['config', 'core.autocrlf', 'false']);
    git(['checkout', '-q', 'main']);
    const tomlPath = path.join(storeDir, 'dricket.toml');
    const toml = readFileSync(tomlPath, 'utf8')
      .replace(/\[transitions\.agent\][\s\S]*?(?=\n\[|$)/, '')
      .replace('values = ["critical", "high", "normal", "low"]', 'values = ["urgent", "high", "normal", "low"]');
    writeFileSync(tomlPath, `${toml}\n[stages]\nvalues = ["inbox", "prioritized", "active", "running", "done"]\ninitial = "inbox"\nterminal = ["done"]\nclaim = ["running"]\ncancelled = "cancelled"\n`);
    git(['commit', '-q', '-am', 'the lifecycle stages']);
    git(['checkout', '-q', 'tickets']);
    envSet('DK_STORE', storeDir);

    const vaultDir = path.join(root, 'meta');
    const kt = path.join(root, 'kt');
    mkdirSync(kt);
    const meta = path.join(vaultDir, 'tickets', '_meta');
    await fsp.mkdir(path.join(meta, 'prompts'), { recursive: true });
    await fsp.writeFile(path.join(meta, 'pipeline.md'), DEFAULT_PIPELINE_TEXT, 'utf8');
    await fsp.writeFile(path.join(meta, 'repos.md'), `---\nrepos:\n  kt:\n    url: https://example.test/kt.git\n    path: '${kt.split(path.sep).join('/')}'\n    branch: main\n---\n`, 'utf8');
    for (const [id, text] of [['ben', PERSONA('agent')], ['pia', PERSONA('mission')], ['ralf', PERSONA('agent')], ['you', PERSONA('human', 'leaving: [commit]\n')]] as const) {
      await fsp.mkdir(path.join(meta, 'personas', id), { recursive: true });
      await fsp.writeFile(path.join(meta, 'personas', id, 'persona.md'), text, 'utf8');
    }
    const fleet: FleetPort = {
      runs: async () => [],
      start: async (request) => {
        started.push(request);
        return { ok: true, run: runInfo(`R-${started.length}`, request.ticketId, 'running') };
      },
      configureChain: async () => undefined,
    };
    const config = { backend: 'dricket', 'dk.path': bin === 'dk' ? '' : bin, 'dk.store': storeDir, 'dk.dataDir': path.join(root, 'data') };
    service = new EngineBoardService(
      hostOver(vaultDir, { id: 'v', name: 'vault', path: vaultDir, exists: true, active: true }, config),
      new TicketsGit(() => 'git', async () => {
        throw new Error('no git in the spec');
      }),
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
  });

  afterAll(async () => {
    service.dispose();
    await service.idle();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    started.length = 0;
  });

  /** An `active` ticket of the store with this chain and cursor. */
  function chained(title: string, chain: string, at: number): { id: string; dkId: string } {
    const dkId = dk(['add', '--unclaimed', '-m', title]).trim();
    const text = content(dkId);
    const file = path.join(root, `${dkId}.md`);
    const header = text.replace(/^stage: .*$/m, `stage: active\nx-chain: ${chain}\nx-at: ${at}`).replace(/^repos:.*$/m, 'repos: kt');
    writeFileSync(file, `${header.replace(/\s*$/, '\n')}\n## Plan\n\n### Acceptance criteria\n\n- [ ] \`echo ok\`\n`);
    const rev = /^rev: (\d+)$/m.exec(text)?.[1] ?? '1';
    dk(['put', dkId, '-F', file, '--claim', '--if-version', rev]);
    return { id: `T-${dkId.slice(2).padStart(4, '0')}`, dkId };
  }

  const columnOf = async (id: string): Promise<string | null> => {
    const snap = await service.snapshot();
    return snap.columns.find((c) => c.tickets.some((t) => t.id === id))?.phase.id ?? null;
  };

  it("stands an active ticket in its holder's column: an agent in Building, You in Ready to try", async () => {
    const agent = chained('At Ben', 'ben;you;ralf;you', 1);
    const owner = chained('At You', 'ben;you;ralf;you', 2);
    expect(await columnOf(agent.id)).toBe('building');
    expect(await columnOf(owner.id)).toBe('ready');
  });

  it("Accept at a middle You entry moves the cursor on; at the last one it starts You's commit", async () => {
    const { id, dkId } = chained('Middle', 'ben;you;ralf;you', 2);
    expect(await service.acceptTicket({ id })).toMatchObject({ ok: true });
    expect(field(dkId, 'x-at')).toBe('3');
    expect(field(dkId, 'stage')).toBe('active');
    expect(await columnOf(id)).toBe('building');

    const last = chained('Last', 'ben;you;ralf;you', 4);
    expect(await service.acceptTicket({ id: last.id })).toMatchObject({ ok: true });
    expect(started.at(-1)).toMatchObject({ ticketId: last.id, machine: { action: 'commit', persona: 'you' } });
    expect(field(last.dkId, 'x-at')).toBe('4');
  });

  it('Send back at You goes to the nearest earlier agent position, never marking the one send-back', async () => {
    const { id, dkId } = chained('Back', 'ben;you;ralf;you', 4);
    expect(await service.sendBack({ id, note: 'the login test fails' })).toMatchObject({ ok: true });
    expect(field(dkId, 'x-at')).toBe('3');
    expect(field(dkId, 'x-sent-back')).toBeNull();
  });

  it("an owner's move into a working column moves the cursor to the position that stands there", async () => {
    const { id, dkId } = chained('Moved', 'ben;you;ralf;you', 2);
    expect(await service.transition({ id, from: 'ready', to: 'building' })).toMatchObject({ ok: true });
    expect(field(dkId, 'x-at')).toBe('3');
    expect(field(dkId, 'x-phase')).toBeNull();
  });

  it('a chain an agent finished (the cursor past the last entry) is moved to done by the engine', async () => {
    const { id, dkId } = chained('Through', 'ben;ralf', 3);
    expect(await columnOf(id)).toBe('done');
    await service.settleFinishedChains();
    expect(field(dkId, 'stage')).toBe('done');
  });

  it("Pia's entry: listed while her cursor stands there, parked for the owner after her turn, finished by a confirmed card", async () => {
    const { id, dkId } = chained('Pia', 'ben;pia;you', 2);
    expect((await service.missionEntries()).filter((e) => e.id === id)).toEqual([{ id, position: 2, length: 3, persona: 'P' }]);

    expect(await service.waitForOwner({ id, key: 'pia-turn', text: 'P proposes 1 change', detail: 'her reply' })).toMatchObject({ ok: true });
    expect(field(dkId, 'x-awaiting')).toBe('you');
    expect((await service.missionEntries()).some((e) => e.id === id)).toBe(false); // waiting for the owner: no second turn
    expect(await columnOf(id)).toBe('ready');

    expect(await service.finishMissionEntry({ id, position: 2 })).toMatchObject({ ok: true });
    expect(field(dkId, 'x-at')).toBe('3');
    expect(field(dkId, 'x-awaiting')).toBeNull();
  });
  it('is a persona board: the crew as lanes, every active card with its hold (req-270)', async () => {
    const { id } = chained('Held', 'ben;you;ralf;you', 3);
    const snap = await service.snapshot();
    expect(snap.lanes?.map((lane) => [lane.persona, lane.kind])).toEqual([['pia', 'mission'], ['ben', 'agent'], ['ralf', 'agent'], ['you', 'human']]);
    const card = snap.columns.flatMap((c) => c.tickets).find((t) => t.id === id);
    expect(card?.hold).toMatchObject({ holder: 'ralf', why: 'entry', position: 3, length: 4, chain: ['ben', 'you', 'ralf', 'you'], claimed: false });
  });

  it('starts, hands and parks a ticket by its persona columns (req-270)', async () => {
    const dkId = dk(['add', '--unclaimed', '-m', 'Fresh idea']).trim();
    const id = `T-${dkId.slice(2).padStart(4, '0')}`;
    expect(await service.personaBoardMove({ kind: 'start', id, persona: 'ben' })).toMatchObject({ ok: true });
    expect(field(dkId, 'stage')).toBe('active');
    expect(field(dkId, 'x-at')).toBe('1');
    expect(field(dkId, 'x-chain')?.split(';')[0]).toBe('ben:shape'); // the dropped-on persona takes the entry at the cursor, its mode with it

    const moved = chained('Hand', 'ben;you;ralf;you', 3);
    expect(await service.personaBoardMove({ kind: 'hand', id: moved.id, persona: 'ben' })).toMatchObject({ ok: true });
    expect(field(moved.dkId, 'x-chain')).toBe('ben;you;ben;you');
    expect(field(moved.dkId, 'x-at')).toBe('3');

    expect(await service.personaBoardMove({ kind: 'park', id: moved.id, stage: 'prioritized' })).toMatchObject({ ok: true });
    expect(field(moved.dkId, 'stage')).toBe('prioritized');
    expect(field(moved.dkId, 'x-at')).toBe('3');
  });

  it("Send back at You goes to the position the owner picked (req-270)", async () => {
    const { id, dkId } = chained('Picked', 'ben;you;ralf;you', 4);
    expect(await service.sendBack({ id, note: 'start over', position: 1 })).toMatchObject({ ok: true });
    expect(field(dkId, 'x-at')).toBe('1');
  });
  // Last in the file: it rewrites the meta vault's pipeline.md and crew.md the cases above read.
  it("migrates the meta vault on the owner's confirmation: step 3 the pipeline, step 4 the crew (req-268)", async () => {
    const held = chained('Through the migration', 'ben;you;ralf;you', 3);
    expect((await service.snapshot()).boardMigration).toMatchObject({ step: 'pipeline', removed: ['Shaping', 'Building', 'Ready to try'], flow: null });
    expect(await service.migrateBoard({ step: 'crew' })).toMatchObject({ ok: false });

    expect(await service.migrateBoard({ step: 'pipeline' })).toMatchObject({ ok: true });
    const pipeline = readFileSync(path.join(root, 'meta', 'tickets', '_meta', 'pipeline.md'), 'utf8');
    expect(pipeline).not.toContain('building');
    const after = await service.snapshot();
    expect(after.pipeline.map((p) => p.id)).toEqual(['inbox', 'prioritized', 'done']);
    expect(after.columns.flatMap((c) => c.tickets).find((t) => t.id === held.id)?.hold).toMatchObject({ holder: 'ralf', position: 3 });
    expect(after.issues.some((issue) => issue.message.includes('"active"'))).toBe(false);
    expect(after.boardMigration).toEqual({ step: 'crew', order: ['pia', 'ben', 'ralf', 'you'], leaving: [{ persona: 'ben', action: 'sync-main' }] });

    expect(await service.migrateBoard({ step: 'crew' })).toMatchObject({ ok: true });
    expect(readFileSync(path.join(root, 'meta', 'tickets', '_meta', 'crew.md'), 'utf8')).toContain('order: [pia, ben, ralf, you]');
    expect(readFileSync(path.join(root, 'meta', 'tickets', '_meta', 'personas', 'ben', 'persona.md'), 'utf8')).toContain('leaving: [sync-main]');
    expect((await service.snapshot()).boardMigration).toBeUndefined();
  });
});
