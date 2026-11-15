import { promises as fsp } from 'node:fs';
import type { TicketsGit } from '../../core/git/tickets-git';
import type { FinishedTarget, RemovalOutcome, WorktreeRemover } from './finished-worktrees';
import { removeWorktree } from './worktree-clean';

/** The finished-worktree removal over real git (`worktree-clean.ts`'s `removeWorktree`, never forced). */
export class GitWorktreeRemover implements WorktreeRemover {
  constructor(private readonly git: Pick<TicketsGit, 'run'>) {}

  exists(worktreePath: string): Promise<boolean> {
    return fsp.stat(worktreePath).then((s) => s.isDirectory(), () => false);
  }

  async remove(target: FinishedTarget): Promise<RemovalOutcome> {
    const outcome = await removeWorktree(this.git, target.repoPath, target.worktreePath, { force: false, links: target.links });
    if (outcome.ok) {
      return { ok: true };
    }
    return outcome.dirty === true ? { ok: false, dirty: true } : { ok: false, error: outcome.error };
  }
}
