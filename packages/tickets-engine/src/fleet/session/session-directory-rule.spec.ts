import { describe, expect, it } from 'vitest';
import { SessionDirectoryRule } from './session-directory-rule';

const rule = new SessionDirectoryRule();
const facts = { isDirectory: true, ticketsVault: 'E:\\Drey-Tickets', liveWorktrees: ['E:\\Drey-Tickets\\_worktrees\\T-0007'] };

describe('SessionDirectoryRule (req-173, R12)', () => {
  it('allows the tickets vault itself, and says it is the vault', () => {
    expect(rule.check('e:/drey-tickets/', facts)).toEqual({ ok: true, directory: 'e:/drey-tickets', ticketsVault: true });
  });

  it('allows any existing local folder', () => {
    expect(rule.check('E:\\projects\\lariscus', facts)).toEqual({ ok: true, directory: 'E:\\projects\\lariscus', ticketsVault: false });
    expect(rule.check('C:\\', facts)).toMatchObject({ ok: true, directory: 'C:\\' });
  });

  it('refuses what is not a local, existing folder', () => {
    expect(rule.check('  ', facts)).toMatchObject({ ok: false, error: 'a free session names its directory' });
    expect(rule.check('projects\\x', facts)).toMatchObject({ ok: false, error: expect.stringContaining('not an absolute path') });
    expect(rule.check('\\\\server\\share', facts)).toMatchObject({ ok: false, error: expect.stringContaining('network share') });
    expect(rule.check('E:\\gone', { ...facts, isDirectory: null })).toMatchObject({ ok: false, error: expect.stringContaining('does not exist') });
    expect(rule.check('E:\\file.txt', { ...facts, isDirectory: false })).toMatchObject({ ok: false, error: expect.stringContaining('not a folder') });
  });

  it('refuses a .git folder and the worktree of a live run, but not a finished run\'s', () => {
    expect(rule.check('E:\\projects\\drey\\.git\\hooks', facts)).toMatchObject({ ok: false, error: expect.stringContaining('.git') });
    expect(rule.check('E:\\Drey-Tickets\\_worktrees\\T-0007\\src', facts)).toMatchObject({ ok: false, error: expect.stringContaining('live run') });
    expect(rule.check('E:\\Drey-Tickets\\_worktrees\\T-0006', facts)).toMatchObject({ ok: true });
  });
});
