/**
 * The fleet's worktree preparation (T-0047, ADR-0075) — the module its
 * importers use. The state machine lives in `workspace/` (ADR-0096):
 * the state table and `prepareWorktreeJob` in `worktree-prepare.ts`, the
 * repo-keyed lock in `repo-lock.ts`, the `link:` junctions in
 * `worktree-links.ts`, porcelain parsing in `worktree-porcelain.ts`, the
 * path comparisons in `worktree-paths.ts`.
 */
import type { PrepareJob } from './workspace/worktree-job';
import { prepareWorktreeJob, type PreparedWorktree } from './workspace/worktree-prepare';

export type { GitSeam, IsLive, PrepareJob, PrepareRequest } from './workspace/worktree-job';
export type { PreparedWorktree } from './workspace/worktree-prepare';
export type { LinkReport } from './workspace/worktree-links';
export type { WorktreeListEntry } from './workspace/worktree-porcelain';
export { parseWorktreePorcelain } from './workspace/worktree-porcelain';
export { linkShared, unlinkShared } from './workspace/worktree-links';
export { normalizeForMatch, realPathOrNull } from './workspace/worktree-paths';

/**
 * Decides the worktree's fate per the ticket's state table. Throws
 * (descriptively, before any mutation) for the fail rows; serialized by
 * the module-level repo lock. `isLive` (T-0044) guards the create path's
 * branch-conflict healing: a registered checkout of the same branch that
 * belongs to a live run is never touched.
 */
export function prepareWorktree(job: PrepareJob): Promise<PreparedWorktree> {
  return prepareWorktreeJob(job);
}
