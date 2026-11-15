/**
 * The fleet's worktree preparation (T-0047, ADR-0075): idempotent per
 * ticket. `git worktree add` alone fails on the second run for the same
 * ticket (next phase, gate retry) with "already exists", so the state
 * of the existing checkout decides what happens instead:
 *
 * - registered and on `t/<id>` — **reused** as is (clean or dirty; a
 *   retry wants exactly the half-finished work);
 * - unregistered, directory missing or empty — **created** (prune, then
 *   add — `-b` only when the branch does not exist yet);
 * - stale (content at the path, no healthy registration) and clean —
 *   **recreated**;
 * - stale and dirty — **moved-aside** to `<path>.stale-<stamp>`, never
 *   deleted; an uninspectable directory counts as dirty (what cannot be
 *   proven clean is not destroyed) — including a leftover folder whose
 *   git answer is an inherited one: the base sits inside the tickets
 *   vault, itself a repo, and a rev-parse would walk up into it;
 * - wrong branch, locked, or a rebase/merge in progress — a descriptive
 *   error, nothing modified (no automatic repair).
 *
 * Every call is serialized by the repo-keyed lock (`repo-lock.ts`).
 */
import { promises as fsp } from 'node:fs';
import type { WorktreeOutcome } from '../protocol';
import { withRepoLock } from './repo-lock';
import { addWorktree } from './worktree-add';
import { assertNoOperationInProgress, currentBranch } from './worktree-git-state';
import type { PrepareJob } from './worktree-job';
import { linkShared, unlinkShared, type LinkReport } from './worktree-links';
import { directoryState, fileExists } from './worktree-paths';
import { findWorktreeEntry, type WorktreeListEntry } from './worktree-porcelain';

export interface PreparedWorktree {
  readonly outcome: WorktreeOutcome;
  /** True only for 'recreated' | 'moved-aside' — prior session context
   *  must not be resumed (consumed by T-0049; nothing reads it in v1). */
  readonly sessionInvalidated: boolean;
  /** Where the stale dirty tree was parked, when outcome === 'moved-aside'. */
  readonly movedTo: string | null;
  /** What became of the repo's `link:` folders (req-56); absent when it names none. */
  readonly links?: LinkReport;
}

/**
 * Decides the worktree's fate per the state table above. Throws
 * (descriptively, before any mutation) for the fail rows; serialized by
 * the module-level repo lock. `isLive` (T-0044) guards the create path's
 * branch-conflict healing: a registered checkout of the same branch that
 * belongs to a live run is never touched.
 */
export async function prepareWorktreeJob(job: PrepareJob): Promise<PreparedWorktree> {
  const { git, request, worktreePath } = job;
  return withRepoLock(request.repoPath, async () => {
    const prepared = await prepareUnlocked(job);
    const links = request.links ?? [];
    return links.length === 0 ? prepared : { ...prepared, links: await linkShared(git, request.repoPath, worktreePath, links) };
  });
}

async function prepareUnlocked(job: PrepareJob): Promise<PreparedWorktree> {
  const { git, request, worktreePath } = job;
  const listing = await git.run(request.repoPath, ['worktree', 'list', '--porcelain']);
  const entry = await findWorktreeEntry(listing, worktreePath);
  if (entry !== null && !entry.prunable) {
    return reuseRegistered(job, entry);
  }

  // No healthy registration: a missing or empty directory is a plain
  // create (prune clears the leftover admin entry first).
  const state = await directoryState(worktreePath);
  if (state !== 'content') {
    await git.run(request.repoPath, ['worktree', 'prune']);
    await addWorktree(job);
    return { outcome: 'created', sessionInvalidated: false, movedTo: null };
  }
  return prepareStale(job);
}

/** Registered and healthy: reuse as is, clean or dirty — zero
 *  mutating git calls. */
async function reuseRegistered(job: PrepareJob, entry: WorktreeListEntry): Promise<PreparedWorktree> {
  const { git, request, worktreePath } = job;
  const expected = `refs/heads/${request.branch}`;
  if (entry.detached || entry.branch !== expected) {
    const found = entry.detached ? 'a detached HEAD' : entry.branch ?? 'no branch';
    throw new Error(
      `worktree ${worktreePath} is on ${found}, expected ${request.branch} — refusing to touch it`,
    );
  }
  if (entry.locked) {
    throw new Error(`worktree ${worktreePath} is locked`);
  }
  await assertNoOperationInProgress(git, worktreePath);
  return { outcome: 'reused', sessionInvalidated: false, movedTo: null };
}

/** Content at the path without a registration — the stale rows. A
 *  directory that no longer answers to git cannot be proven clean:
 *  it is moved aside, never deleted. */
async function prepareStale(job: PrepareJob): Promise<PreparedWorktree> {
  const { git, request, worktreePath } = job;
  const branch = await currentBranch(git, worktreePath);
  if (branch === null) {
    return replaceStale(job);
  }
  if (branch !== request.branch) {
    const found = branch === 'HEAD' ? 'a detached HEAD' : branch;
    throw new Error(
      `worktree ${worktreePath} is on ${found}, expected ${request.branch} — refusing to touch it`,
    );
  }
  await assertNoOperationInProgress(git, worktreePath);
  const status = await git.run(worktreePath, ['status', '--porcelain']);
  if (status.trim() === '') {
    await git.run(request.repoPath, ['worktree', 'prune']);
    await unlinkShared(worktreePath, request.links ?? []);
    await fsp.rm(worktreePath, { recursive: true, force: true });
    await addWorktree(job);
    return { outcome: 'recreated', sessionInvalidated: true, movedTo: null };
  }
  return replaceStale(job);
}

/** The dirty-stale row: rename aside (kept), then a fresh checkout. */
async function replaceStale(job: PrepareJob): Promise<PreparedWorktree> {
  const movedTo = await moveAside(job.worktreePath, job.now);
  await job.git.run(job.request.repoPath, ['worktree', 'prune']);
  await addWorktree(job);
  return { outcome: 'moved-aside', sessionInvalidated: true, movedTo };
}

/** `<path>.stale-<YYYYMMDDTHHMMSS>`, suffixed -2, -3, … on collision —
 *  the injected clock may be frozen, so same-second collisions are a
 *  spec reality. */
async function moveAside(worktreePath: string, now: () => Date): Promise<string> {
  const stamp = now().toISOString().replaceAll(/[-:]/g, '').slice(0, 15);
  let candidate = `${worktreePath}.stale-${stamp}`;
  let n = 2;
  while (await fileExists(candidate)) {
    candidate = `${worktreePath}.stale-${stamp}-${n}`;
    n++;
  }
  await fsp.rename(worktreePath, candidate);
  return candidate;
}
