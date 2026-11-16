import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeVaultDisk } from './node-vault-disk';

/** The Node adapter's own behaviour: the case-only rename (D-74) and the occupied-target refusal. */
describe('NodeVaultDisk', () => {
  let root = '';
  const disk = new NodeVaultDisk();

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'drey-vault-disk-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('renames to a new casing of the same name, file or folder (D-74)', async () => {
    writeFileSync(path.join(root, 'Note.md'), 'text');
    mkdirSync(path.join(root, 'Concepts'));
    writeFileSync(path.join(root, 'Concepts/one.md'), '1');

    await disk.rename(path.join(root, 'Note.md'), path.join(root, 'note.md'));
    await disk.rename(path.join(root, 'Concepts'), path.join(root, 'concepts'));

    // The two names resolve to the same entries on Windows and macOS --
    // only the directory listing tells the on-disk casing apart.
    const names = readdirSync(root);
    expect(names).toEqual(expect.arrayContaining(['note.md', 'concepts']));
    expect(names).not.toEqual(expect.arrayContaining(['Note.md', 'Concepts']));
    expect(readFileSync(path.join(root, 'note.md'), 'utf8')).toBe('text');
    expect(readFileSync(path.join(root, 'concepts/one.md'), 'utf8')).toBe('1');
  });

  it('still refuses a rename onto a genuinely existing entry', async () => {
    writeFileSync(path.join(root, 'a.md'), 'a');
    writeFileSync(path.join(root, 'b.md'), 'b');

    await expect(disk.rename(path.join(root, 'a.md'), path.join(root, 'b.md'))).rejects.toThrow(/already exists/);
    expect(readFileSync(path.join(root, 'a.md'), 'utf8')).toBe('a');
    expect(readFileSync(path.join(root, 'b.md'), 'utf8')).toBe('b');
  });
});
