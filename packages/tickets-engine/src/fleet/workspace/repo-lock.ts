/**
 * Every worktree preparation is serialized by a module-level lock keyed
 * by the repo path: two concurrent starts for one ticket cannot race on
 * `worktree add`, and neither can two different tickets' prepares in
 * the same repo (parallel runs of a pool share it — one runner process, one
 * supervisor per adapter, only module scope is shared).
 */
import { normalizeForMatch } from './worktree-paths';

const repoLocks = new Map<string, Promise<unknown>>();

/** One worktree-mutating sequence per repo at a time; the stored tail is
 *  the SETTLED promise, so a failing prepare neither blocks the next
 *  call nor leaves an unhandled rejection (the TicketsGit.run pattern). */
export function withRepoLock<T>(repoPath: string, task: () => Promise<T>): Promise<T> {
  const key = repoLockKey(repoPath);
  const prev = repoLocks.get(key) ?? Promise.resolve();
  const result = prev.then(task);
  const settled = result.catch(() => undefined);
  repoLocks.set(key, settled);
  void settled.then(() => {
    if (repoLocks.get(key) === settled) {
      repoLocks.delete(key);
    }
  });
  return result;
}

/** Resolved, forward-slashed, case-folded on win32 — porcelain prints
 *  `C:/…` while `path.join` yields backslashes. */
function repoLockKey(p: string): string {
  return normalizeForMatch(p);
}
