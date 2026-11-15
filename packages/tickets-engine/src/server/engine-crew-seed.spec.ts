import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seededCrewOf } from '../core/crew-seed-marker';
import { parsePersonaFile } from '../core/persona';
import { createEngine, type Engine } from './engine';

const run = promisify(execFile);

/** req-256 over the real engine: the start seeds the default crew once, and a board that was initialized with it keeps it. */

const PIPELINE = '---\nphases:\n  - { id: inbox, title: Inbox, handover: manual }\n  - { id: build, title: Build, claim: true, handover: agent build-default }\n  - { id: done, title: Done, handover: none }\n---\nThe pipeline.\n';
const PERSONAS = 'tickets/_meta/personas';

let root = '';
let vault = '';
let home = '';
const engines: Engine[] = [];
const git = async (args: string[]): Promise<string> => (await run('git', args, { cwd: vault })).stdout;
const read = (rel: string): Promise<string | null> => fsp.readFile(path.join(vault, rel), 'utf8').catch(() => null);
const start = async (): Promise<Engine> => {
  const engine = await createEngine({ vaultPath: vault, home, clientDir: path.join(root, 'client'), log: () => undefined });
  engines.push(engine);
  await engine.ready;
  return engine;
};

describe('the engine seeds the default crew at its start (req-256)', () => {
  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(tmpdir(), 'drey-engine-crew-'));
    vault = path.join(root, 'vault');
    home = path.join(root, 'home');
    await fsp.mkdir(path.join(vault, 'tickets/_meta'), { recursive: true });
    await fsp.mkdir(path.join(root, 'client'), { recursive: true });
    await fsp.mkdir(home, { recursive: true });
    await fsp.writeFile(path.join(vault, 'tickets/_meta/pipeline.md'), PIPELINE, 'utf8');
    await git(['init', '-b', 'main']);
    await git(['config', 'user.name', 'spec']);
    await git(['config', 'user.email', 'spec@example.com']);
    await git(['add', '-A']);
    await git(['commit', '-m', 'seed']);
  });

  afterEach(async () => {
    await Promise.all(engines.splice(0).map((engine) => engine.close()));
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('gives an existing board without the crew Pia, Paul, Ben, Ralf and Tessa in one commit, and the Crew tab lists them', async () => {
    const engine = await start();
    for (const [id, role] of [['paul', 'planner'], ['ben', 'builder'], ['ralf', 'reviewer'], ['tessa', 'tester']] as const) {
      expect(parsePersonaFile(id, (await read(`${PERSONAS}/${id}/persona.md`))!)).toMatchObject({ role, class: 'heavy', model: null });
    }
    expect(parsePersonaFile('pia', (await read(`${PERSONAS}/pia/persona.md`))!)).toMatchObject({ kind: 'mission', title: 'Pia' });
    expect(seededCrewOf(await read('tickets/_meta/crew.md'))).toEqual(['pia', 'paul', 'ben', 'ralf', 'tessa']);
    expect((await git(['log', '--format=%s'])).trim().split('\n')).toEqual(['projects: the first project "vault" from repos.md and the registered vaults (req-282)', 'personas: the default crew (req-256)', 'seed']);
    expect((await git(['status', '--porcelain', '--', 'tickets/_meta'])).trim()).toBe('');
    const ids = ((await engine.invoke('personas')) as readonly { id: string }[]).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['pia', 'paul', 'ben', 'ralf', 'tessa']));
  });

  it('seeds once: the next start adds nothing, and a persona the owner deleted stays deleted', async () => {
    await (await start()).close();
    await fsp.rm(path.join(vault, PERSONAS, 'ralf'), { recursive: true });
    await git(['add', '-A']);
    await git(['commit', '-m', 'owner removes ralf']);
    await start();
    expect(await read(`${PERSONAS}/ralf/persona.md`)).toBeNull();
    expect((await git(['log', '--format=%s'])).trim().split('\n')).toEqual(['owner removes ralf', 'projects: the first project "vault" from repos.md and the registered vaults (req-282)', 'personas: the default crew (req-256)', 'seed']);
  });

  it('leaves the owner\'s own personas and pipeline as they are — but moves a v2 record onto class and model once (req-288)', async () => {
    await fsp.mkdir(path.join(vault, PERSONAS, 'mina'), { recursive: true });
    const own = "---\ntitle: Mina\nrole: builder\nworker: kimi\nmodels:\n  default: owner-model\n  pool: [owner-model]\ncolor: '#123456'\nskills: []\n---\n";
    await fsp.writeFile(path.join(vault, PERSONAS, 'mina/persona.md'), own, 'utf8');
    await git(['add', '-A']);
    await git(['commit', '-m', 'owner persona']);
    const engine = await start();
    await engine.ready;
    const migrated = (await read(`${PERSONAS}/mina/persona.md`))!;
    expect(parsePersonaFile('mina', migrated)).toMatchObject({ title: 'Mina', class: 'heavy', model: 'kimi/owner-model', color: '#123456' });
    expect(migrated).not.toMatch(/^(worker|models):/m);
    expect((await git(['log', '--format=%s'])).trim().split('\n')).toContain('personas: class and model replace worker and models (req-288)');
    expect(await read('tickets/_meta/pipeline.md')).toBe(PIPELINE);
  });
});
