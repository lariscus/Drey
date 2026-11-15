/**
 * The tickets repo's `.gitignore` covers the fleet's reserved root folders
 * (ADR-0080: ensured, not documented): the worktrees base `_worktrees/` and,
 * since req-183, the workers' ticket copies in `_workcopy/`. Pure — the
 * board service reads and writes the file.
 */
import { WORKCOPY_DIR, WORKTREES_DIR } from '../fleet/worktrees/worktree-home';

/** The entries for a tickets repo at `prefix` (`''` at the git root, else `sub/dir/`). */
export function reservedIgnoreEntries(prefix: string): readonly string[] {
  return [`/${prefix}${WORKTREES_DIR}/`, `/${prefix}${WORKCOPY_DIR}/`];
}

/** The file with the missing entries appended, or null when every entry is already there. */
export function withIgnoreEntries(current: string | null, entries: readonly string[]): string | null {
  const lines = (current ?? '').split('\n').map((line) => line.trim());
  const missing = entries.filter((entry) => !lines.includes(entry));
  if (missing.length === 0) {
    return null;
  }
  const text = current ?? '';
  const lead = text === '' || text.endsWith('\n') ? '' : '\n';
  return `${text}${lead}${missing.map((entry) => `${entry}\n`).join('')}`;
}
