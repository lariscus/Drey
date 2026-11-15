import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parsePersonaFile } from '../core/persona/persona';
import type { ModelRow } from '../fleet/protocol';
import type { EngineHost, EngineVault } from './host';
import { PERSONA_MODEL_MIGRATION_COMMIT, PersonaModelMigrator } from './persona-model-migrator';

const DIR = 'tickets/_meta/personas';
const row = (provider: ModelRow['provider'], model: string, cls: string): ModelRow => ({ provider, model, class: cls, slot: null, category: '', cost: 1, enabled: true });
const ROWS: readonly ModelRow[] = [row('claude-code', 'claude-opus-5-5', 'heavy'), row('claude-code', 'claude-sonnet-5-5', 'standard'), row('kimi', 'kimi-k3.1-pro', 'heavy')];

describe('PersonaModelMigrator — worker and models become class and model, once (req-288)', () => {
  let root: string;
  let commits: { paths: readonly string[]; message: string }[];
  let logs: string[];
  let migrator: PersonaModelMigrator;
  let rows: readonly ModelRow[] | null;

  const write = async (id: string, text: string): Promise<void> => {
    await fsp.mkdir(path.join(root, DIR, id), { recursive: true });
    await fsp.writeFile(path.join(root, DIR, id, 'persona.md'), text, 'utf8');
  };
  const read = (id: string): Promise<string> => fsp.readFile(path.join(root, DIR, id, 'persona.md'), 'utf8');

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-persona-v3-'));
    commits = [];
    logs = [];
    rows = ROWS;
    const vault: EngineVault = { id: 'v', name: 'tickets', path: root, exists: true, active: true };
    const host = {
      read: (_v: string, rel: string) => fsp.readFile(path.join(root, rel), 'utf8'),
      write: (_v: string, rel: string, text: string) => fsp.writeFile(path.join(root, rel), text, 'utf8'),
      announceChanges: () => undefined,
    } as unknown as Pick<EngineHost, 'read' | 'write' | 'announceChanges'>;
    migrator = new PersonaModelMigrator({
      board: { detect: async () => vault, listPersonaIds: async () => (await fsp.readdir(path.join(root, DIR))).sort() },
      host,
      table: { rows: async () => rows },
      git: { locate: async () => ({ root, prefix: '' }), commitPaths: async (_r, paths, message) => void commits.push({ paths, message }) },
      log: (message) => void logs.push(message),
    });
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('gives each v2 agent the class of its old default and pins the default only when the pool held one model — one commit', async () => {
    await write('ben', "---\ntitle: Ben\nrole: builder\nworker: claude-code\nmodels:\n  default: claude-sonnet-5-5\n  pool: [claude-sonnet-5-5, claude-opus-5-5]\ncolor: '#8ecbef'\nskills: []\n---\nBen's own prose.\n");
    await write('ralf', "---\ntitle: Ralf\nrole: reviewer\nworker: kimi\nmodels:\n  default: kimi-k3.1-pro\n  pool: [kimi-k3.1-pro]\nmin-class: light\ncolor: '#bfe3cd'\nskills: []\n---\n");
    await write('you', "---\ntitle: You\nkind: human\nrole: custom\nworker: opencode\nmodels:\n  default: opus\n  pool: [opus]\ncolor: '#38bdf8'\nskills: []\n---\n");
    expect(await migrator.migrateAll()).toEqual(['ben', 'ralf']);
    const ben = await read('ben');
    expect(ben).toContain('class: standard\n');
    expect(ben).not.toMatch(/^(worker|models|model|min-class):/m);
    expect(ben).toContain("Ben's own prose.");
    expect(parsePersonaFile('ralf', await read('ralf'))).toMatchObject({ class: 'heavy', model: 'kimi/kimi-k3.1-pro' });
    expect(await read('you')).toContain('worker: opencode'); // the human is not an agent: untouched
    expect(commits).toEqual([{ paths: [`${DIR}/ben/persona.md`, `${DIR}/ralf/persona.md`], message: PERSONA_MODEL_MIGRATION_COMMIT }]);
    expect(logs.join('\n')).toContain('persona ralf: class the default\'s class heavy, kimi/kimi-k3.1-pro pinned (the pool held only it) (req-288)');
  });

  it('is idempotent: a migrated record is skipped, nothing is written or committed', async () => {
    await write('ben', '---\ntitle: Ben\nclass: heavy\n---\n');
    const before = await read('ben');
    expect(await migrator.migrateAll()).toEqual([]);
    expect(await read('ben')).toBe(before);
    expect(commits).toEqual([]);
  });

  it('without a model table the floor decides, else the fallback class', async () => {
    rows = null;
    await write('ben', '---\ntitle: Ben\nworker: claude-code\nmodels:\n  default: x\n  pool: [x, y]\nmin-class: standard\n---\n');
    await write('tessa', '---\ntitle: Tessa\nworker: claude-code\nmodels:\n  default: x\n  pool: [x, y]\n---\n');
    await migrator.migrateAll();
    expect(parsePersonaFile('ben', await read('ben')).class).toBe('standard');
    expect(parsePersonaFile('tessa', await read('tessa')).class).toBe('heavy');
  });
});
