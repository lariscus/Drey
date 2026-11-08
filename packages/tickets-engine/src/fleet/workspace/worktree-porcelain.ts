import { realPathOrNull, sameWorktreePath } from './worktree-paths';

export interface WorktreeListEntry {
  /** Normalized: forward slashes (porcelain prints `C:/…`; `path.join`
   *  yields backslashes — compared case-folded on win32, with a
   *  `realpath` second chance against path aliases, see
   *  `findWorktreeEntry`). */
  readonly path: string;
  /** `refs/heads/<name>`; null = detached or bare. */
  readonly branch: string | null;
  readonly detached: boolean;
  readonly locked: boolean;
  readonly prunable: boolean;
}

/** Parses `git worktree list --porcelain` (entries separated by blank
 *  lines; `locked`/`prunable` may carry a reason after the keyword). */
export function parseWorktreePorcelain(text: string): readonly WorktreeListEntry[] {
  const entries: WorktreeListEntry[] = [];
  let current: { path: string; branch: string | null; detached: boolean; locked: boolean; prunable: boolean } | null =
    null;
  const flush = (): void => {
    if (current !== null) {
      entries.push(current);
    }
  };
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush();
      current = {
        path: line.slice('worktree '.length).trim().replaceAll('\\', '/'),
        branch: null,
        detached: false,
        locked: false,
        prunable: false,
      };
      continue;
    }
    if (current === null) {
      continue;
    }
    if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).trim();
    } else if (line === 'detached') {
      current.detached = true;
    } else if (line.startsWith('locked')) {
      current.locked = true;
    } else if (line.startsWith('prunable')) {
      current.prunable = true;
    }
  }
  flush();
  return entries;
}

/**
 * Finds the worktree's entry in the listing. String form decides first
 * (the common case — both sides spell the same path); as a second
 * chance both sides go through `realpath`, because git canonicalizes
 * the paths it reports through the filesystem while the caller's path
 * can reach the same directory through an alias — an 8.3 short name
 * (`RUNNER~1` for `runneradmin`, the shape of the GitHub Windows
 * runner's temp dir) or a junction. A path that cannot be resolved
 * (a registered but vanished tree) only ever matches by string form.
 */
export async function findWorktreeEntry(
  porcelain: string,
  worktreePath: string,
): Promise<WorktreeListEntry | null> {
  const entries = parseWorktreePorcelain(porcelain);
  for (const entry of entries) {
    if (sameWorktreePath(entry.path, worktreePath)) {
      return entry;
    }
  }
  const requested = await realPathOrNull(worktreePath);
  if (requested === null) {
    return null;
  }
  for (const entry of entries) {
    const real = await realPathOrNull(entry.path);
    if (real !== null && sameWorktreePath(real, requested)) {
      return entry;
    }
  }
  return null;
}
