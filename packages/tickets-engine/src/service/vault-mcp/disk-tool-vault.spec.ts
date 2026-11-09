import { describe, expect, it } from 'vitest';
import { DiskToolVault, type VaultSite } from './disk-tool-vault';
import { MemoryVaultDisk } from './memory-vault-disk.fake';

/** req-167: the service's `ToolVault` — the registered vaults on disk, under the Notes API's served-path rule. */
const SITES: VaultSite[] = [
  { id: 'notes', name: 'Notes', path: '/v/notes', active: false, exists: true },
  { id: 'work', name: 'Work', path: '/v/work', active: true, exists: true },
  { id: 'gone', name: 'Gone', path: '/v/gone', active: false, exists: false },
];

function vault(): { tools: DiskToolVault; disk: MemoryVaultDisk } {
  const disk = new MemoryVaultDisk()
    .seed('/v/notes', { 'a.md': 'alpha', 'sub/b.md': 'beta', 'img/x.png': 'png', 'tickets/T-1.md': 'ticket', 'chats/c.md': 'chat', '.drafts/d.md': 'draft' })
    .seed('/v/work', { 'w.md': 'work' });
  return { tools: new DiskToolVault(SITES, disk), disk };
}

describe('DiskToolVault (req-167)', () => {
  it('lists the registered vaults with the active one; a missing folder is listed as not existing', () => {
    const { tools } = vault();
    expect(tools.listVaults().map((v) => [v.id, v.exists, v.active])).toEqual([
      ['notes', true, false],
      ['work', true, true],
      ['gone', false, false],
    ]);
    expect(tools.getActiveVaultId()).toBe('work');
  });

  it('lists only served files: no tickets/, no chats/, no dot-folder', async () => {
    const { tools } = vault();
    expect(await tools.listMarkdownFiles('notes')).toEqual(['a.md', 'sub/b.md']);
    const tree = await tools.listFiles('notes');
    expect(tree.map((e) => e.relativePath)).toEqual(['a.md', 'img', 'sub']);
  });

  it('reads and writes inside a vault; a write reports the new mtime', async () => {
    const { tools, disk } = vault();
    expect((await tools.readFile('a.md', 'notes')).content).toBe('alpha');
    const mtime = await tools.writeFile('new/n.md', 'n', 'notes');
    expect(disk.files.get('/v/notes/new/n.md')).toEqual({ text: 'n', mtime });
  });

  it('refuses every path the rule keeps out, and a link that leads out of the vault', async () => {
    const { tools, disk } = vault();
    disk.escapes.add('linked');
    for (const rel of ['tickets/T-1.md', 'chats/c.md', '.drafts/d.md', '../x.md', 'linked/y.md']) {
      await expect(tools.readFile(rel, 'notes')).rejects.toThrow(/out of reach/);
      await expect(tools.writeFile(rel, 'x', 'notes')).rejects.toThrow(/out of reach/);
    }
  });

  it('refuses an unknown or missing vault, and never deletes', async () => {
    const { tools } = vault();
    await expect(tools.readFile('a.md', 'gone')).rejects.toThrow(/no vault "gone"/);
    await expect(tools.deleteEntry()).rejects.toThrow(/not offered/);
  });

  it('moves inside one vault only, and copies an attachment beside its note', async () => {
    const { tools, disk } = vault();
    expect(await tools.renameEntry('a.md', 'moved/a.md', 'notes', 'notes')).toBe('moved/a.md');
    expect(disk.files.has('/v/notes/moved/a.md')).toBe(true);
    await expect(tools.renameEntry('sub/b.md', 'b.md', 'notes', 'work')).rejects.toThrow(/inside one vault/);
    expect(await tools.copyEntry('img/x.png', 'moved', 'notes')).toBe('moved/x.png');
  });

  it('reports a modification time, or null when the file is missing or out of reach', async () => {
    const { tools } = vault();
    expect(await tools.mtimeOf('a.md', 'notes')).toEqual(expect.any(Number));
    expect(await tools.mtimeOf('none.md', 'notes')).toBeNull();
    expect(await tools.mtimeOf('tickets/T-1.md', 'notes')).toBeNull();
  });
});
