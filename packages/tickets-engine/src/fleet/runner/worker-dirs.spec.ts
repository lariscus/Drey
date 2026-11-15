import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { shellArg } from './procs';
import { workerWriteDirsOf } from './worker-dirs';

const VAULT = path.resolve('/tickets');

describe('the folders a worker may write beyond its worktree (req-185)', () => {
  it("a store ticket's working copy folder and the further repositories' worktrees", () => {
    const dirs = workerWriteDirsOf({
      ticketsVaultPath: VAULT,
      ticketRelPath: 'tickets/build/T-0001.md',
      ticketId: 'T-0001',
      dk: { store: 'drey', claimStage: 'build' } as never,
      extraRepos: [{ name: 'site', repoPath: '/site', worktreePath: '/site-wt/T-0001', baseRef: 'main' }],
    });
    expect(dirs).toEqual([path.join(VAULT, '_workcopy'), '/site-wt/T-0001']);
  });

  it("on the files backend the ticket's own folder in the tickets repository", () => {
    expect(workerWriteDirsOf({ ticketsVaultPath: VAULT, ticketRelPath: 'tickets/build/T-0001.md', ticketId: 'T-0001' })).toEqual([path.join(VAULT, 'tickets', 'build')]);
  });

  it('a free session or a 1:1 works in its one folder', () => {
    expect(workerWriteDirsOf({ ticketsVaultPath: VAULT, ticketRelPath: '', ticketId: 'free' })).toEqual([]);
    expect(workerWriteDirsOf({ ticketsVaultPath: VAULT, ticketRelPath: 'x.md', ticketId: '1:1', session: { kind: '1:1', persona: 'pia', workingDirectory: VAULT } as never })).toEqual([]);
  });
});

describe('an argument through the Windows shell (req-185)', () => {
  it('quotes a path with a space or a shell character on Windows only', () => {
    expect(shellArg('C:/Users/A B/.drey-engine/fleet/runs/R-1/claude-settings.json', true)).toBe('"C:/Users/A B/.drey-engine/fleet/runs/R-1/claude-settings.json"');
    expect(shellArg('E:/projects/drey-tickets/_workcopy', true)).toBe('E:/projects/drey-tickets/_workcopy');
    expect(shellArg('a&b', true)).toBe('"a&b"');
    expect(shellArg('/home/a b/x', false)).toBe('/home/a b/x');
  });
});
