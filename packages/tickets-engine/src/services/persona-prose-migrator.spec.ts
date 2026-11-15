import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parsePersonaFile, type Persona } from '../core/persona/persona';
import type { EngineHost, EngineVault } from './host';
import { PersonaProseMigrator } from './persona-prose-migrator';

const FRONT = "---\ntitle: Ben\nrole: builder\nworker: claude-code\nmodels:\n  default: opus\n  pool: [opus]\ncolor: '#888888'\nskills: []\n---\n";
const DIR = 'tickets/_meta/personas';

describe('PersonaProseMigrator — one prose, not two (R11, req-171)', () => {
  let root = '';
  let logs: string[];
  let announced: string[][];

  const write = async (rel: string, text: string): Promise<void> => {
    await fsp.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fsp.writeFile(path.join(root, rel), text, 'utf8');
  };
  const read = (rel: string): Promise<string | null> => fsp.readFile(path.join(root, rel), 'utf8').catch(() => null);

  function boot(ids: readonly string[]): PersonaProseMigrator {
    const vault = { id: 'v', name: 'tickets', path: root, exists: true, active: true } as unknown as EngineVault;
    const host = {
      read: async (_v: string, p: string) => fsp.readFile(path.join(root, p), 'utf8'),
      write: (_v: string, p: string, text: string) => write(p, text),
      announceChanges: (_v: string, paths: string[]) => announced.push(paths),
    } as unknown as EngineHost;
    const loadPersona = async (_v: EngineVault, id: string): Promise<Persona | null> => {
      const text = await read(`${DIR}/${id}/persona.md`);
      return text === null ? null : parsePersonaFile(id, text);
    };
    return new PersonaProseMigrator({ board: { detect: async () => vault, loadPersona, listPersonaIds: async () => ids }, host, log: (m) => logs.push(m) });
  }

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-prose-'));
    logs = [];
    announced = [];
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('moves the prose to the top of prompt.md, strips persona.md and logs it once', async () => {
    await write(`${DIR}/ben/persona.md`, `${FRONT}\nCalm, terse.\n`);
    await write(`${DIR}/ben/prompt.md`, '## How you work\n\n- Small commits.\n');
    expect(await boot(['ben']).migrateAll()).toBe(1);
    expect(await read(`${DIR}/ben/persona.md`)).toBe(FRONT);
    expect(await read(`${DIR}/ben/prompt.md`)).toBe('## Who Ben is\n\nCalm, terse.\n\n## How you work\n\n- Small commits.\n');
    expect(logs).toEqual(['persona ben: persona.md prose moved into prompt.md (1 lines)']);
    expect(announced).toEqual([[`${DIR}/ben/persona.md`, `${DIR}/ben/prompt.md`]]);
  });

  it('drops the old placeholder sentence and leaves prompt.md as it is', async () => {
    await write(`${DIR}/ben/persona.md`, `${FRONT}\nWho Ben is: role, tone, limits. Edit freely — the next run reads it.\n`);
    await write(`${DIR}/ben/prompt.md`, 'Own text.\n');
    expect(await boot(['ben']).migrateAll()).toBe(1);
    expect(await read(`${DIR}/ben/persona.md`)).toBe(FRONT);
    expect(await read(`${DIR}/ben/prompt.md`)).toBe('Own text.\n');
  });

  it('is idempotent: a second run changes nothing and logs nothing', async () => {
    await write(`${DIR}/ben/persona.md`, `${FRONT}\nCalm.\n`);
    const migrator = boot(['ben']);
    expect(await migrator.migrateAll()).toBe(1);
    const after = [await read(`${DIR}/ben/persona.md`), await read(`${DIR}/ben/prompt.md`)];
    logs = [];
    expect(await migrator.migrateAll()).toBe(0);
    expect([await read(`${DIR}/ben/persona.md`), await read(`${DIR}/ben/prompt.md`)]).toEqual(after);
    expect(logs).toEqual([]);
  });

  it('skips a persona whose file is gone without failing the others', async () => {
    await write(`${DIR}/ben/persona.md`, `${FRONT}\nCalm.\n`);
    expect(await boot(['ghost', 'ben']).migrateAll()).toBe(1);
  });
});
