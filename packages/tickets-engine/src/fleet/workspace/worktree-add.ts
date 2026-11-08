import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { PrepareJob } from './worktree-job';
import { unlinkShared } from './worktree-links';
import { sameWorktreePath } from './worktree-paths';
import { parseWorktreePorcelain, type WorktreeListEntry } from './worktree-porcelain';

/** `worktree add` on the existing branch, or `-b` from the base ref
 *  when the ticket's branch does not exist yet. Never `--force`. */
export async function addWorktree(job: PrepareJob): Promise<void> {
  const { git, request, worktreePath } = job;
  await healBranchConflict(job);
  await fsp.mkdir(path.dirname(worktreePath), { recursive: true });
  const hasBranch = await git
    .run(request.repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${request.branch}`])
    .then(() => true)
    .catch(() => false);
  const args = hasBranch
    ? ['worktree', 'add', worktreePath, request.branch]
    : ['worktree', 'add', '-b', request.branch, worktreePath, request.baseRef ?? 'HEAD'];
  await git.run(request.repoPath, args);
}

/**
 * The re-run trap (T-0044, ADR-0080): `git worktree add` refuses a
 * branch another registered worktree still has checked out — a settled
 * ticket's leftover checkout (typically in the legacy fleet root) would
 * make every retry fail forever. A conflicting registration that is
 * provably clean and not live is removed first (real git, never
 * `--force`); anything else is a descriptive refusal.
 */
async function healBranchConflict(job: PrepareJob): Promise<void> {
  const { git, request } = job;
  const listing = await git.run(request.repoPath, ['worktree', 'list', '--porcelain']);
  const expected = `refs/heads/${request.branch}`;
  for (const entry of parseWorktreePorcelain(listing)) {
    if (entry.branch !== expected || entry.prunable) {
      continue; // prunable admin leftovers are the following prune's job
    }
    await assertRemovable(job, entry);
    // The links go first: git's worktree removal leaves junctions behind,
    // and a leftover folder at the path poisons the next prepare.
    await unlinkShared(entry.path, request.links ?? []);
    await git.run(request.repoPath, ['worktree', 'remove', entry.path]);
  }
}

/** Throws, descriptively, unless the conflicting checkout is provably
 *  clean, not the repo's own, not live and not locked. */
async function assertRemovable(job: PrepareJob, entry: WorktreeListEntry): Promise<void> {
  const { git, request, isLive } = job;
  if (sameWorktreePath(entry.path, request.repoPath)) {
    throw new Error(
      `branch ${request.branch} is checked out in the repo's own checkout (${entry.path}) — switch it back first`,
    );
  }
  if (isLive !== undefined && isLive(entry.path)) {
    throw new Error(
      `branch ${request.branch} is checked out in ${entry.path}, which a live run is working in — stop the run first`,
    );
  }
  if (entry.locked) {
    throw new Error(`branch ${request.branch} is checked out in the locked worktree ${entry.path}`);
  }
  const status = await git.run(entry.path, ['status', '--porcelain']).catch(() => null);
  if (status === null) {
    throw new Error(
      `branch ${request.branch} is checked out in ${entry.path}, which no longer answers to git — remove it by hand`,
    );
  }
  if (status.trim() !== '') {
    throw new Error(
      `branch ${request.branch} is checked out in the dirty worktree ${entry.path} — commit or stash there, then retry`,
    );
  }
}
