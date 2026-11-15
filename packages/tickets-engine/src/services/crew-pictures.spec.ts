import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SEEDED_PICTURES_KEY, seededListOf } from '../core/persona/crew-seed-marker';
import { CrewConfigFiles } from './crew-config-files';
import { CREW_PICTURES_COMMIT, CrewPictures } from './crew-pictures';
import type { EngineHost, EngineVault } from './host';
import { PersonaAvatars, SHIPPED_AVATAR_IDS } from './persona-avatars';
import { PersonaFolders } from './persona-folders';
import { SHIPPED_PERSONAS_DIR } from './shipped-crew-files';

const DIR = 'tickets/_meta/personas';
const CREW = 'tickets/_meta/crew.md';
const SEEDED = ['pia', 'paul', 'ben', 'ralf', 'tessa'];

/** A tickets vault in a temp folder: a board seeded before req-292 — the crew and `you`, no pictures. */
class OldBoard {
  readonly commits: { readonly paths: readonly string[]; readonly message: string }[] = [];
  readonly logs: string[] = [];
  readonly vault: EngineVault;
  readonly pictures: CrewPictures;

  private constructor(readonly root: string) {
    this.vault = { id: 'v', name: 'tickets', path: root, exists: true, active: true };
    const host = {
      read: (_vault: string, rel: string) => fsp.readFile(this.abs(rel), 'utf8'),
      write: (_vault: string, rel: string, text: string) => this.write(rel, text),
      announceChanges: () => undefined,
      log: (message: string) => void this.logs.push(message),
      resolveAssetPath: (_vault: string, rel: string) => this.abs(rel),
    } as unknown as EngineHost;
    const git = {
      locate: async () => ({ root: '/repo', prefix: '' }),
      commitPaths: async (_root: string, paths: readonly string[], message: string) => void this.commits.push({ paths, message }),
    };
    this.pictures = new CrewPictures({
      host,
      git,
      folders: new PersonaFolders(host),
      avatars: new PersonaAvatars(host),
      crewFiles: new CrewConfigFiles(host, git),
      log: (message) => void this.logs.push(message),
    });
  }

  static async create(): Promise<OldBoard> {
    const board = new OldBoard(await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-crew-pictures-')));
    await board.write(CREW, `---\nseeded-crew: [${SEEDED.join(', ')}]\n---\n`);
    for (const id of [...SEEDED, 'you']) {
      await board.write(`${DIR}/${id}/persona.md`, `---\ntitle: ${id}\n---\n`);
    }
    return board;
  }

  abs(rel: string): string {
    return path.join(this.root, rel);
  }

  async write(rel: string, text: string | Buffer): Promise<void> {
    await fsp.mkdir(path.dirname(this.abs(rel)), { recursive: true });
    await fsp.writeFile(this.abs(rel), text);
  }

  bytes(rel: string): Promise<Buffer | null> {
    return fsp.readFile(this.abs(rel)).catch(() => null);
  }

  async crewText(): Promise<string> {
    return fsp.readFile(this.abs(CREW), 'utf8');
  }

  dispose(): Promise<void> {
    return fsp.rm(this.root, { recursive: true, force: true });
  }
}

describe('CrewPictures — the shipped pictures for a board seeded before them (req-292)', () => {
  let board: OldBoard;

  beforeEach(async () => {
    board = await OldBoard.create();
  });

  afterEach(async () => {
    await board.dispose();
  });

  it('gives the seeded crew and you the shipped picture, marks them and commits once', async () => {
    expect(await board.pictures.backfill(board.vault)).toEqual({ kind: 'pictured', ids: [...SEEDED, 'you'] });
    for (const id of [...SEEDED, 'you']) {
      const shipped = await fsp.readFile(path.join(SHIPPED_PERSONAS_DIR, id, 'avatar.png'));
      expect((await board.bytes(`${DIR}/${id}/avatar.png`))?.equals(shipped)).toBe(true);
    }
    expect(seededListOf(await board.crewText(), SEEDED_PICTURES_KEY)).toEqual([...SEEDED, 'you']);
    expect(board.commits).toEqual([{ message: CREW_PICTURES_COMMIT, paths: [...[...SEEDED, 'you'].map((id) => `${DIR}/${id}/avatar.png`), CREW] }]);
  });

  it('keeps the other keys of crew.md', async () => {
    await board.pictures.backfill(board.vault);
    expect(await board.crewText()).toContain('seeded-crew: [pia, paul, ben, ralf, tessa]');
  });

  it('runs once: a second start finds nothing to do and commits nothing', async () => {
    await board.pictures.backfill(board.vault);
    expect(await board.pictures.backfill(board.vault)).toEqual({ kind: 'nothing' });
    expect(board.commits).toHaveLength(1);
  });

  it('never overwrites a picture the owner put there (it only joins the list)', async () => {
    const own = Buffer.from('my own picture');
    await board.write(`${DIR}/ben/avatar.png`, own);
    const result = await board.pictures.backfill(board.vault);
    expect(result).toEqual({ kind: 'pictured', ids: ['pia', 'paul', 'ralf', 'tessa', 'you'] });
    expect((await board.bytes(`${DIR}/ben/avatar.png`))?.equals(own)).toBe(true);
    expect(seededListOf(await board.crewText(), SEEDED_PICTURES_KEY)).toContain('ben');
    expect(board.commits[0]!.paths).not.toContain(`${DIR}/ben/avatar.png`);
  });

  it('does not re-create a persona the owner deleted', async () => {
    await fsp.rm(board.abs(`${DIR}/ralf`), { recursive: true, force: true });
    const result = await board.pictures.backfill(board.vault);
    expect(result).toEqual({ kind: 'pictured', ids: ['pia', 'paul', 'ben', 'tessa', 'you'] });
    expect(await board.bytes(`${DIR}/ralf/avatar.png`)).toBeNull();
    expect((await fsp.stat(board.abs(`${DIR}/ralf`)).catch(() => null))).toBeNull();
  });

  it('leaves a picture the owner removed after the backfill removed', async () => {
    await board.pictures.backfill(board.vault);
    await fsp.rm(board.abs(`${DIR}/tessa/avatar.png`));
    expect(await board.pictures.backfill(board.vault)).toEqual({ kind: 'nothing' });
    expect(await board.bytes(`${DIR}/tessa/avatar.png`)).toBeNull();
  });

  it('skips you while its persona does not exist yet', async () => {
    await fsp.rm(board.abs(`${DIR}/you`), { recursive: true, force: true });
    expect(await board.pictures.backfill(board.vault)).toEqual({ kind: 'pictured', ids: SEEDED });
    expect(seededListOf(await board.crewText(), SEEDED_PICTURES_KEY)).not.toContain('you');
  });

  it('refuses a crew.md that does not parse and writes nothing', async () => {
    await board.write(CREW, '---\nseeded-crew: [pia\n---\n');
    expect((await board.pictures.backfill(board.vault)).kind).toBe('refused');
    expect(await board.bytes(`${DIR}/pia/avatar.png`)).toBeNull();
    expect(board.commits).toEqual([]);
  });

  it('the package ships a picture for every seeded persona and for you', async () => {
    for (const id of SHIPPED_AVATAR_IDS) {
      const bytes = await fsp.readFile(path.join(SHIPPED_PERSONAS_DIR, id, 'avatar.png'));
      expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
    }
    expect([...SHIPPED_AVATAR_IDS].sort()).toEqual([...SEEDED, 'you'].sort());
  });
});
