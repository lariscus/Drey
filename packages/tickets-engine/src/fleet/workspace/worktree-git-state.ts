import * as path from 'node:path';
import type { GitSeam } from './worktree-job';
import { fileExists, realPathOrNull, sameWorktreePath } from './worktree-paths';

/** A rebase/merge must never be reused over or moved aside mid-flight.
 *  The markers resolve through the worktree's own git dir
 *  (`--git-path` prints the admin-absolute path), so this is
 *  locale-free and needs no git status parsing. */
const IN_PROGRESS_MARKERS: readonly { readonly marker: string; readonly op: string }[] = [
  { marker: 'rebase-merge', op: 'rebase' },
  { marker: 'rebase-apply', op: 'rebase' },
  { marker: 'MERGE_HEAD', op: 'merge' },
  { marker: 'CHERRY_PICK_HEAD', op: 'cherry-pick' },
  { marker: 'REVERT_HEAD', op: 'revert' },
  { marker: 'BISECT_LOG', op: 'bisect' },
];

export async function assertNoOperationInProgress(git: GitSeam, worktreePath: string): Promise<void> {
  for (const { marker, op } of IN_PROGRESS_MARKERS) {
    const out = await git.run(worktreePath, ['rev-parse', '--git-path', marker]);
    const file = out.trim();
    if (file === '') {
      continue;
    }
    const abs = path.isAbsolute(file) ? file : path.join(worktreePath, file);
    if (await fileExists(abs)) {
      throw new Error(`worktree ${worktreePath} has a ${op} in progress`);
    }
  }
}

/** The branch a still-runnable directory is on (`t/<id>`; `HEAD` when
 *  detached), or null when the directory no longer answers to git *as
 *  itself*. The worktree base sits inside the tickets vault — itself a
 *  git repo — so a bare rev-parse walks up out of a leftover folder and
 *  reports the VAULT's branch as if it were the folder's; the toplevel
 *  guard turns that inherited answer back into "no longer answers". */
export async function currentBranch(git: GitSeam, worktreePath: string): Promise<string | null> {
  try {
    const toplevel = (await git.run(worktreePath, ['rev-parse', '--show-toplevel'])).trim();
    if (!(await isOwnToplevel(toplevel, worktreePath))) {
      return null;
    }
    return (await git.run(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  } catch {
    return null;
  }
}

/** True when git's toplevel IS the worktree path (either spelling — git
 *  reports canonical paths while the caller may hold an alias). */
async function isOwnToplevel(toplevel: string, worktreePath: string): Promise<boolean> {
  if (sameWorktreePath(toplevel, worktreePath)) {
    return true;
  }
  const realToplevel = await realPathOrNull(toplevel);
  const realWorktree = await realPathOrNull(worktreePath);
  return realToplevel !== null && realWorktree !== null && sameWorktreePath(realToplevel, realWorktree);
}
