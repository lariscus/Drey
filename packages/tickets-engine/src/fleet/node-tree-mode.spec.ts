import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeTreeMode } from './node-tree-mode';

/** req-183: the review checkout's second layer — its files read-only on disk, then writable again for the removal. */
describe('NodeTreeMode — a checkout read-only on disk', () => {
  let root: string;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-tree-mode-'));
    await fsp.mkdir(path.join(root, 'src'));
    await fsp.writeFile(path.join(root, 'src', 'a.ts'), 'export {};');
    await fsp.writeFile(path.join(root, 'README.md'), 'hi');
  });

  afterEach(async () => {
    await new NodeTreeMode().setReadOnly(root, false).catch(() => undefined);
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('a locked file refuses a write; unlocked it takes one again', async () => {
    const mode = new NodeTreeMode();
    await mode.setReadOnly(root, true);
    await expect(fsp.writeFile(path.join(root, 'src', 'a.ts'), 'changed')).rejects.toThrow();
    await expect(fsp.writeFile(path.join(root, 'README.md'), 'changed')).rejects.toThrow();
    await mode.setReadOnly(root, false);
    await fsp.writeFile(path.join(root, 'src', 'a.ts'), 'changed');
    expect(await fsp.readFile(path.join(root, 'src', 'a.ts'), 'utf8')).toBe('changed');
  });

  it.skipIf(process.platform === 'win32')('on POSIX a locked folder refuses a new file too', async () => {
    const mode = new NodeTreeMode();
    await mode.setReadOnly(root, true);
    await expect(fsp.writeFile(path.join(root, 'src', 'new.ts'), 'x')).rejects.toThrow();
  });

  it('the files are still readable while locked', async () => {
    await new NodeTreeMode().setReadOnly(root, true);
    expect(await fsp.readFile(path.join(root, 'src', 'a.ts'), 'utf8')).toBe('export {};');
  });
});
