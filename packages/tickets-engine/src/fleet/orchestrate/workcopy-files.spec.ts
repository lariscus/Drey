import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '../ports/memory-file-system.fake';
import { legacyTicketCopyPathFor, ticketCopyPathFor } from '../worktree-home';
import { WorkcopyFiles } from './workcopy-files';

/** req-183: the working copy moved from `_worktrees/<id>.ticket.md` to `_workcopy/<id>.ticket.md`; one release reads both. */
describe('WorkcopyFiles — the ticket copy in _workcopy/, the old place read for one release', () => {
  const VAULT = 'V:/tickets';
  const current = ticketCopyPathFor(VAULT, 'T-0001');
  const legacy = legacyTicketCopyPathFor(VAULT, 'T-0001');
  const setup = (): { fs: MemoryFileSystem; files: WorkcopyFiles; lines: string[] } => {
    const fs = new MemoryFileSystem();
    const lines: string[] = [];
    return { fs, files: new WorkcopyFiles(fs, (line) => lines.push(line)), lines };
  };

  it('the copy is written to _workcopy/, never to _worktrees/', async () => {
    const { fs, files } = setup();
    await files.write(VAULT, 'T-0001', 'ticket');
    expect(current).toMatch(/_workcopy[\\/]T-0001\.ticket\.md$/);
    expect(fs.files.get(current)).toBe('ticket');
    expect(fs.files.has(legacy)).toBe(false);
  });

  it('new path only: it is read, nothing is migrated or logged', async () => {
    const { fs, files, lines } = setup();
    fs.files.set(current, 'new');
    expect(await files.read(VAULT, 'T-0001')).toBe('new');
    expect(lines).toEqual([]);
  });

  it('old path only: it is read and moved into place once, with one log line', async () => {
    const { fs, files, lines } = setup();
    fs.files.set(legacy, 'old');
    expect(await files.read(VAULT, 'T-0001')).toBe('old');
    expect(fs.files.get(current)).toBe('old');
    expect(fs.files.has(legacy)).toBe(false);
    expect(await files.read(VAULT, 'T-0001')).toBe('old');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('moved from');
  });

  it('both present: the new copy wins and the old one is dropped', async () => {
    const { fs, files, lines } = setup();
    fs.files.set(current, 'new');
    fs.files.set(legacy, 'old');
    expect(await files.read(VAULT, 'T-0001')).toBe('new');
    expect(fs.files.has(legacy)).toBe(false);
    expect(lines).toHaveLength(1);
  });

  it('neither present: null', async () => {
    const { files } = setup();
    expect(await files.read(VAULT, 'T-0001')).toBeNull();
  });

  it('a failed move leaves the old copy in place and still returns its text', async () => {
    const { fs, files, lines } = setup();
    fs.files.set(legacy, 'old');
    fs.writeText = () => Promise.reject(new Error('disk full'));
    expect(await files.read(VAULT, 'T-0001')).toBe('old');
    expect(fs.files.get(legacy)).toBe('old');
    expect(lines[0]).toContain('failed');
  });

  it('drop removes both places', async () => {
    const { fs, files } = setup();
    fs.files.set(current, 'new');
    fs.files.set(legacy, 'old');
    await files.drop(VAULT, 'T-0001');
    expect(fs.files.size).toBe(0);
  });
});
