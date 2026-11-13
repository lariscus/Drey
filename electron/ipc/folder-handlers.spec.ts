import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
const revealed: string[] = [];

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
  shell: { showItemInFolder: (p: string) => revealed.push(p) },
}));

import { IPC_CHANNELS } from '../../shared/ipc-api';
import { listPlainFolder, registerFolderHandlers } from './folder-handlers';

let tmp = '';
let root = '';

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drey-folder-'));
  root = path.join(tmp, 'shared');
  fs.mkdirSync(path.join(root, 'specs', 'deep'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Archive'));
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, 'schema.md'), '# Schema');
  fs.writeFileSync(path.join(root, 'Glossary.md'), '# Glossary');
  fs.writeFileSync(path.join(root, '.hidden.md'), 'x');
  fs.writeFileSync(path.join(root, 'specs', 'a.md'), 'a');
  fs.writeFileSync(path.join(tmp, 'secret.md'), 'outside');
});

afterEach(() => {
  handlers.clear();
  revealed.length = 0;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('listPlainFolder', () => {
  it('lists one level, directories first, then by name, without dot names', async () => {
    const { entries } = await listPlainFolder({ root, rel: '' });
    expect(entries).toEqual([
      { name: 'Archive', type: 'directory' },
      { name: 'specs', type: 'directory' },
      { name: 'Glossary.md', type: 'file' },
      { name: 'schema.md', type: 'file' },
    ]);
  });

  it('lists a forward-slash sub-path', async () => {
    const { entries, files } = await listPlainFolder({ root, rel: 'specs' });
    expect(entries).toEqual([
      { name: 'deep', type: 'directory' },
      { name: 'a.md', type: 'file' },
    ]);
    expect(files).toEqual([path.join(root, 'specs', 'a.md')]);
  });

  it('refuses a root that is not absolute', async () => {
    await expect(listPlainFolder({ root: 'shared', rel: '' })).rejects.toThrow(/absolute/);
  });

  it('refuses a sub-path that leaves the root', async () => {
    await expect(listPlainFolder({ root, rel: '..' })).rejects.toThrow(/outside/);
    await expect(listPlainFolder({ root, rel: 'specs/../..' })).rejects.toThrow(/outside/);
  });

  it('refuses a symlink inside the root that points outside it', async () => {
    const link = path.join(root, 'escape');
    try {
      fs.symlinkSync(tmp, link, 'junction');
    } catch {
      return; // no symlink rights on this machine: nothing to check
    }
    await expect(listPlainFolder({ root, rel: 'escape' })).rejects.toThrow(/outside/);
  });

  it('rejects a folder that does not exist', async () => {
    await expect(listPlainFolder({ root: path.join(tmp, 'gone'), rel: '' })).rejects.toThrow();
  });
});

describe('registerFolderHandlers', () => {
  it('answers folder:list with the entries and admits the listed files read-only', async () => {
    const admitReadOnly = vi.fn();
    registerFolderHandlers({ externalFiles: { admitReadOnly } });
    const handler = handlers.get(IPC_CHANNELS.folderList);
    expect(handler).toBeDefined();
    const entries = await handler!({}, { root, rel: '' });
    expect(entries).toHaveLength(4);
    expect(admitReadOnly).toHaveBeenCalledWith([
      path.join(root, 'Glossary.md'),
      path.join(root, 'schema.md'),
    ]);
  });

  it('reveals a path inside the folder, and refuses one outside it', async () => {
    registerFolderHandlers({ externalFiles: { admitReadOnly: vi.fn() } });
    const reveal = handlers.get(IPC_CHANNELS.folderReveal)!;
    await reveal({}, { root, rel: 'specs/a.md' });
    expect(revealed).toEqual([fs.realpathSync.native(path.join(root, 'specs', 'a.md'))]);
    await expect(reveal({}, { root, rel: '../secret.md' })).rejects.toThrow(/outside/);
    expect(revealed).toHaveLength(1);
  });
});
