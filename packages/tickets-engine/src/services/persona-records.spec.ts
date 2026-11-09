import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parsePersonaFile, type Persona } from '../core/persona';
import type { EngineHost, EngineVault } from './host';
import { PersonaRecords } from './persona-records';

const BEN = "---\ntitle: Ben\nrole: builder\nworker: claude-code\nmodels:\n  default: opus\n  pool: [opus]\ncolor: '#888888'\nskills: []\n---\n";
const DIR = 'tickets/_meta/personas/ben';
const JOURNAL = '# Reviews\n\n- 2026-11-09T10:00:00Z · T-0102 · ben · claude-code/sonnet · gate red · $0.42\n  - signals: red-gate\n- 2026-11-09T11:00:00Z · T-0103 · ben · claude-code/sonnet · gate green · $0.10\n  - signals: steer\n';

describe('PersonaRecords — the Memory tab on the board side (req-169)', () => {
  let root = '';
  let logs: string[];

  const write = async (rel: string, text: string): Promise<void> => {
    await fsp.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fsp.writeFile(path.join(root, rel), text, 'utf8');
  };
  const read = (rel: string): Promise<string | null> => fsp.readFile(path.join(root, rel), 'utf8').catch(() => null);

  function boot(): PersonaRecords {
    const vault = { id: 'v', name: 'tickets', path: root, exists: true, active: true } as unknown as EngineVault;
    const host = {
      read: async (_v: string, p: string) => fsp.readFile(path.join(root, p), 'utf8'),
      write: (_v: string, p: string, text: string) => write(p, text),
      resolveAssetPath: (_v: string, p: string) => path.join(root, p),
      announceChanges: () => undefined,
    } as unknown as EngineHost;
    const loadPersona = async (_v: EngineVault, id: string): Promise<Persona | null> => {
      const text = await read(`tickets/_meta/personas/${id}/persona.md`);
      return text === null ? null : parsePersonaFile(id, text);
    };
    return new PersonaRecords({ board: { detect: async () => vault, loadPersona, listPersonaIds: async () => ['ben'] }, host, log: (m) => logs.push(m) });
  }

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-records-'));
    logs = [];
    await write(`${DIR}/persona.md`, BEN);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('reads the journal oldest first; an unknown persona refuses readably', async () => {
    await write(`${DIR}/reviews.md`, JOURNAL);
    const reply = await boot().journal('ben');
    expect(reply.ok && reply.entries.map((e) => e.ticket)).toEqual(['T-0102', 'T-0103']);
    expect(await boot().journal('ghost')).toMatchObject({ ok: false, error: expect.stringContaining('does not exist') });
  });

  it('removes one journal entry by index and stamp; a stale stamp refuses', async () => {
    await write(`${DIR}/reviews.md`, JOURNAL);
    const records = boot();
    expect(await records.journalRemove({ persona: 'ben', index: 0, at: '2026-11-09T11:00:00Z' })).toMatchObject({ ok: false });
    const reply = await records.journalRemove({ persona: 'ben', index: 0, at: '2026-11-09T10:00:00Z' });
    expect(reply.ok && reply.entries.map((e) => e.ticket)).toEqual(['T-0103']);
    expect(await read(`${DIR}/reviews.md`)).not.toContain('T-0102');
  });

  it("removes one memory line — the persona's or the owner's — by index and text", async () => {
    await write(`${DIR}/memory.md`, '# Memory\n\n- 2026-11-09 · T-0102 · ben/sonnet · run the verify script\n- 2026-11-09 · you · ask before renaming\n');
    const reply = await boot().memoryRemove({ persona: 'ben', index: 0, text: '2026-11-09 · T-0102 · ben/sonnet · run the verify script' });
    expect(reply).toMatchObject({ ok: true, entries: [{ author: 'you', lesson: 'ask before renaming' }] });
    expect(await read(`${DIR}/memory.md`)).toBe('# Memory\n\n- 2026-11-09 · you · ask before renaming\n');
    expect(await boot().memoryRemove({ persona: 'ben', index: 0, text: 'something else' })).toMatchObject({ ok: false });
  });

  it('migrates friction.md once into the journal start and removes it, logged', async () => {
    await write(`${DIR}/reviews.md`, JOURNAL);
    await write(`${DIR}/friction.md`, '# Friction\n\n- 2026-11-01 · T-0007 · guessed the order.md shape\n');
    expect(await boot().migrateAll()).toBe(1);
    expect(await read(`${DIR}/friction.md`)).toBeNull();
    const reply = await boot().journal('ben');
    expect(reply.ok && reply.entries.map((e) => [e.at, e.friction, e.note])).toEqual([
      ['2026-11-01', 'guessed the order.md shape', 'migrated from friction.md'],
      ['2026-11-09T10:00:00Z', null, null],
      ['2026-11-09T11:00:00Z', null, null],
    ]);
    expect(logs).toContain('persona ben: friction.md migrated into reviews.md (1 lines)');
    expect(await boot().migrateAll()).toBe(0); // once
  });
});
