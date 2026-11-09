import { describe, expect, it, vi } from 'vitest';
import { GitChangeSize, numstatLines } from './git-change-size';

describe('GitChangeSize', () => {
  it("sums the numstat of the run's own commits since its start", async () => {
    const git = vi.fn(async () => '12\t3\tsrc/a.ts\n\n200\t37\tsrc/b.ts\n-\t-\tlogo.png\n');
    const lines = await new GitChangeSize(() => git).linesOf({ worktreePath: 'W:/wt', startedAt: '2026-11-09T12:00:00Z' });
    expect(lines).toEqual({ added: 212, removed: 40 });
    expect(git).toHaveBeenCalledWith('W:/wt', ['log', '--since=2026-11-09T12:00:00Z', '--numstat', '--format=']);
  });

  it('gives null when the worktree cannot be read, never a guess', async () => {
    const failing = new GitChangeSize(() => async () => Promise.reject(new Error('not a git repository')));
    expect(await failing.linesOf({ worktreePath: 'W:/gone', startedAt: '2026-11-09T12:00:00Z' })).toBeNull();
    expect(await failing.linesOf({ worktreePath: ' ', startedAt: '2026-11-09T12:00:00Z' })).toBeNull();
  });

  it('reads an empty log as no change', () => {
    expect(numstatLines('')).toEqual({ added: 0, removed: 0 });
  });
});
