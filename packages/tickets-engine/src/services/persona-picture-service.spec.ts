import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SEEDED_PICTURES_KEY, seededListOf } from '../core/crew-seed-marker';
import { CrewConfigFiles } from './crew-config-files';
import type { EngineHost, EngineVault } from './host';
import { PersonaAvatars, PNG_SIGNATURE } from './persona-avatars';
import { PersonaFolders } from './persona-folders';
import { PersonaPictureService } from './persona-picture-service';

const DIR = 'tickets/_meta/personas';
const CREW = 'tickets/_meta/crew.md';
const PNG = Buffer.concat([PNG_SIGNATURE, Buffer.from('a tiny picture')]);
const dataUrl = (bytes: Buffer): string => `data:image/png;base64,${bytes.toString('base64')}`;

describe('PersonaPictureService — the owner changes and removes a persona picture (req-288, D-67)', () => {
  let root: string;
  let commits: { paths: readonly string[]; message: string }[];
  let changed: number;
  let service: PersonaPictureService;

  const exists = async (rel: string): Promise<boolean> => (await fsp.stat(path.join(root, rel)).catch(() => null)) !== null;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-picture-'));
    commits = [];
    changed = 0;
    for (const id of ['ben', 'zoe']) {
      await fsp.mkdir(path.join(root, DIR, id), { recursive: true });
    }
    const vault: EngineVault = { id: 'v', name: 'tickets', path: root, exists: true, active: true };
    const host = {
      read: (_v: string, rel: string) => fsp.readFile(path.join(root, rel), 'utf8'),
      write: async (_v: string, rel: string, text: string) => {
        await fsp.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
        await fsp.writeFile(path.join(root, rel), text, 'utf8');
      },
      announceChanges: () => undefined,
      resolveAssetPath: (_v: string, rel: string) => path.join(root, rel),
    } as unknown as EngineHost;
    const git = {
      locate: async () => ({ root, prefix: '' }),
      commitTree: async (_r: string, paths: readonly string[], message: string) => void commits.push({ paths, message }),
      commitPaths: async () => undefined,
    };
    service = new PersonaPictureService({
      board: { detect: async () => vault },
      host,
      git,
      folders: new PersonaFolders(host),
      files: new PersonaAvatars(host),
      crewFiles: new CrewConfigFiles(host, git),
      changed: () => void changed++,
      log: () => undefined,
    });
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('an upload writes personas/<id>/avatar.png as one commit and tells the clients', async () => {
    expect(await service.set({ persona: 'ben', dataUrl: dataUrl(PNG) })).toEqual({ ok: true });
    expect(await fsp.readFile(path.join(root, DIR, 'ben', 'avatar.png'))).toEqual(PNG);
    expect(commits).toEqual([{ paths: [`${DIR}/ben/avatar.png`], message: 'personas: ben picture' }]);
    expect(changed).toBe(1);
  });

  it('refuses what is no PNG, a missing persona and a broken id — and writes nothing', async () => {
    expect(await service.set({ persona: 'ben', dataUrl: 'data:image/jpeg;base64,AAAA' })).toMatchObject({ ok: false, error: expect.stringContaining('data:image/png') });
    expect(await service.set({ persona: 'ben', dataUrl: dataUrl(Buffer.from('not a png')) })).toMatchObject({ ok: false, error: 'the picture is not a PNG' });
    expect(await service.set({ persona: 'nobody', dataUrl: dataUrl(PNG) })).toMatchObject({ ok: false, error: 'persona "nobody" not found' });
    expect(await service.set({ persona: '../x', dataUrl: dataUrl(PNG) })).toMatchObject({ ok: false });
    expect(commits).toEqual([]);
  });

  it("removing a shipped persona's picture marks its id in seeded-pictures: in the same commit, so the backfill leaves it removed", async () => {
    await service.set({ persona: 'ben', dataUrl: dataUrl(PNG) });
    expect(await service.remove({ persona: 'ben' })).toEqual({ ok: true });
    expect(await exists(`${DIR}/ben/avatar.png`)).toBe(false);
    expect(seededListOf(await fsp.readFile(path.join(root, CREW), 'utf8'), SEEDED_PICTURES_KEY)).toEqual(['ben']);
    expect(commits[1]).toEqual({ paths: [`${DIR}/ben/avatar.png`, CREW], message: 'personas: ben picture removed' });
  });

  it('removing an own persona\'s picture leaves crew.md alone; nothing to remove is refused', async () => {
    await service.set({ persona: 'zoe', dataUrl: dataUrl(PNG) });
    expect(await service.remove({ persona: 'zoe' })).toEqual({ ok: true });
    expect(commits[1]!.paths).toEqual([`${DIR}/zoe/avatar.png`]);
    expect(await exists(CREW)).toBe(false);
    expect(await service.remove({ persona: 'zoe' })).toMatchObject({ ok: false, error: 'persona zoe has no picture' });
  });
});
