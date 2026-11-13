import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BoardAvatars } from './board-avatars';
import type { EngineVault } from './host';
import { AVATAR_MAX_BYTES, PersonaAvatars, avatarPathOf } from './persona-avatars';
import { SHIPPED_PERSONAS_DIR } from './shipped-crew-files';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('PersonaAvatars and BoardAvatars — the persona pictures (req-292)', () => {
  let root: string;
  let vault: EngineVault;
  let avatars: PersonaAvatars;
  let board: BoardAvatars;

  const put = async (id: string, bytes: Buffer): Promise<void> => {
    await fsp.mkdir(path.join(root, path.dirname(avatarPathOf(id))), { recursive: true });
    await fsp.writeFile(path.join(root, avatarPathOf(id)), bytes);
  };

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-avatars-'));
    vault = { id: 'v', name: 'tickets', path: root, exists: true, active: true };
    avatars = new PersonaAvatars({ resolveAssetPath: (_vault, rel) => path.join(root, rel) });
    board = new BoardAvatars({ detect: async () => vault }, avatars);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('copies the shipped picture into the persona folder', async () => {
    expect(await avatars.copyShipped(vault, 'ben')).toBe('tickets/_meta/personas/ben/avatar.png');
    const shipped = await fsp.readFile(path.join(SHIPPED_PERSONAS_DIR, 'ben', 'avatar.png'));
    expect((await fsp.readFile(path.join(root, avatarPathOf('ben')))).equals(shipped)).toBe(true);
    expect(await avatars.has(vault, 'ben')).toBe(true);
  });

  it('never overwrites a picture that is there', async () => {
    await put('ben', PNG);
    expect(await avatars.copyShipped(vault, 'ben')).toBeNull();
    expect((await fsp.readFile(path.join(root, avatarPathOf('ben')))).equals(PNG)).toBe(true);
  });

  it('copies nothing for a persona the package ships no picture for', async () => {
    expect(await avatars.copyShipped(vault, 'carla')).toBeNull();
    expect(await avatars.has(vault, 'carla')).toBe(false);
  });

  it('versions change with the file, and a persona without a picture has none', async () => {
    await put('ben', PNG);
    expect(await board.versions(['ben', 'paul'])).toEqual({ ben: expect.any(String) });
    const first = (await board.versions(['ben']))['ben'];
    await put('ben', Buffer.concat([PNG, PNG]));
    expect((await board.versions(['ben']))['ben']).not.toBe(first);
  });

  it('serves a PNG as a data URL and refuses what has none', async () => {
    await put('ben', PNG);
    expect(await board.dataUrl('ben')).toEqual({ ok: true, dataUrl: `data:image/png;base64,${PNG.toString('base64')}` });
    expect(await board.dataUrl('paul')).toEqual({ ok: false, error: 'persona paul has no picture' });
  });

  it('serves no file that is not a PNG, nor one larger than the cap', async () => {
    await put('ben', Buffer.from('<svg/>'));
    expect(await board.bytes('ben')).toBeNull();
    await put('ralf', Buffer.concat([PNG, Buffer.alloc(AVATAR_MAX_BYTES)]));
    expect(await board.bytes('ralf')).toBeNull();
    expect(await board.versions(['ralf'])).toEqual({});
  });

  it('never reads outside the persona grammar', async () => {
    expect(await board.bytes('../crew')).toBeNull();
    expect(await board.versions(['../crew', 'Ben'])).toEqual({});
  });

  it('reads no picture without a tickets vault', async () => {
    const none = new BoardAvatars({ detect: async () => null }, avatars);
    await put('ben', PNG);
    expect(await none.versions(['ben'])).toEqual({});
    expect((await none.dataUrl('ben')).ok).toBe(false);
  });
});
