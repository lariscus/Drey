import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineVault } from './host';
import { PersonaFolders } from './persona-folders';

describe('PersonaFolders', () => {
  let root = '';
  const vault = { id: 'v' } as EngineVault;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-persona-folders-'));
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('knows a persona by its folder, whatever the folder holds', async () => {
    await fsp.mkdir(path.join(root, 'tickets', '_meta', 'personas', 'ben'), { recursive: true });
    await fsp.writeFile(path.join(root, 'tickets', '_meta', 'personas', 'paul'), 'a file, not a folder');
    const folders = new PersonaFolders({ resolveAssetPath: (_v, rel) => path.join(root, rel) });
    expect(await folders.has(vault, 'ben')).toBe(true);
    expect(await folders.has(vault, 'paul')).toBe(false);
    expect(await folders.has(vault, 'ghost')).toBe(false);
  });

  it('says no when the path leaves the vault', async () => {
    expect(await new PersonaFolders({ resolveAssetPath: () => null }).has(vault, 'ben')).toBe(false);
  });
});
