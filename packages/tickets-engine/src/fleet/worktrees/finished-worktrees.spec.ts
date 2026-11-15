import { describe, expect, it } from 'vitest';
import { finishedLines, FinishedWorktrees, targetsOfRequest, type FinishedTarget, type RemovalOutcome, type WorktreeRemover } from './finished-worktrees';

/** A remover over a table of folders: what is there, and what git answers for each. */
function remover(table: Readonly<Record<string, RemovalOutcome | 'throws'>>): WorktreeRemover & { readonly asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    exists: async (p) => p in table,
    remove: async (target: FinishedTarget) => {
      asked.push(target.worktreePath);
      const outcome = table[target.worktreePath]!;
      if (outcome === 'throws') {
        throw new Error('git is gone');
      }
      return outcome;
    },
  };
}

const target = (worktreePath: string): FinishedTarget => ({ repoPath: '/repo', worktreePath, links: [] });

describe("a finished ticket's worktrees (req-185)", () => {
  it('removes the clean ones, keeps a dirty one and one git refuses, and skips what is not there', async () => {
    const fake = remover({ '/wt/a': { ok: true }, '/wt/b': { ok: false, dirty: true }, '/wt/c': { ok: false, error: 'locked working tree' }, '/wt/d': 'throws' });
    const report = await new FinishedWorktrees(fake).removeAll([target('/wt/a'), target('/wt/b'), target('/wt/c'), target('/wt/d'), target('/wt/gone')]);
    expect(fake.asked).toEqual(['/wt/a', '/wt/b', '/wt/c', '/wt/d']);
    expect(report.removed).toEqual(['/wt/a']);
    expect(report.kept).toEqual([
      { path: '/wt/b', reason: 'it has uncommitted changes' },
      { path: '/wt/c', reason: 'locked working tree' },
      { path: '/wt/d', reason: 'git is gone' },
    ]);
  });

  it('says each outcome in one line, the branch named as staying', () => {
    expect(finishedLines({ removed: ['/wt/a'], kept: [{ path: '/wt/b', reason: 'it has uncommitted changes' }] }, 't/T-0001')).toEqual([
      'worktree removed: /wt/a (the branch t/T-0001 stays)',
      'worktree kept: /wt/b — it has uncommitted changes',
    ]);
  });

  it("takes the request's own worktree and its further repositories' with their links", () => {
    const targets = targetsOfRequest({
      repoPath: '/drey',
      worktreePath: '/wt/T-0001',
      links: ['node_modules'],
      extraRepos: [{ name: 'site', repoPath: '/site', worktreePath: '/site-wt/T-0001', baseRef: 'main' }],
    });
    expect(targets).toEqual([
      { repoPath: '/drey', worktreePath: '/wt/T-0001', links: ['node_modules'] },
      { repoPath: '/site', worktreePath: '/site-wt/T-0001', links: [] },
    ]);
  });
});
