import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { GitSeam } from './worktree-job';
import { isDirectory, lexists } from './worktree-paths';

/** The `link:` folders by fate: linked now, already there, or left out (with why). */
export interface LinkReport {
  readonly linked: readonly string[];
  readonly present: readonly string[];
  readonly skipped: readonly { readonly path: string; readonly reason: string }[];
}

/**
 * Links the repo's git-ignored toolchain folders into the worktree
 * (req-56): a fresh checkout has no `.tools` / `node_modules`, and every
 * worker spent its first calls finding that out and improvising —
 * junctions of its own, even `npm ci`. A folder is linked only when the
 * checkout has it, the worktree does not, and git ignores it there (a
 * link git would see is a change on the ticket branch). A junction on
 * Windows (no admin rights needed), a directory symlink elsewhere.
 */
export async function linkShared(
  git: GitSeam,
  repoPath: string,
  worktreePath: string,
  links: readonly string[],
): Promise<LinkReport> {
  const linked: string[] = [];
  const present: string[] = [];
  const skipped: { path: string; reason: string }[] = [];
  for (const rel of links) {
    const source = path.join(repoPath, rel);
    const target = path.join(worktreePath, rel);
    if (await lexists(target)) {
      present.push(rel);
      continue;
    }
    if (!(await isDirectory(source))) {
      skipped.push({ path: rel, reason: 'the checkout has no such folder' });
      continue;
    }
    // Asked as a folder (`rel/`): the link does not exist yet, and a
    // folder-only pattern (`node_modules/`) matches nothing else. The
    // seam runs git with --literal-pathspecs, which check-ignore refuses
    // outright — the second flag lifts it for this one call.
    const ignored = await git
      .run(worktreePath, ['--no-literal-pathspecs', 'check-ignore', '-q', '--', `${rel}/`])
      .then(() => true)
      .catch(() => false);
    if (!ignored) {
      skipped.push({ path: rel, reason: 'git does not ignore it — a link would show as a change' });
      continue;
    }
    try {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir');
      linked.push(rel);
    } catch (error) {
      skipped.push({ path: rel, reason: `link failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return { linked, present, skipped };
}

/**
 * Removes the links before a worktree is deleted, so a recursive delete
 * can never reach through a junction into the checkout's own folders.
 * Only symbolic links / junctions are removed; a real folder stays. The
 * top level is swept too: earlier workers made such junctions themselves.
 * Shared with every removal path (worktree-clean, the board's Files
 * command) — git's own worktree removal leaves junctions behind.
 */
export async function unlinkShared(worktreePath: string, links: readonly string[]): Promise<void> {
  const top = await fsp.readdir(worktreePath).catch(() => [] as string[]);
  for (const rel of new Set([...links, ...top])) {
    const target = path.join(worktreePath, rel);
    const stat = await fsp.lstat(target).catch(() => null);
    if (stat?.isSymbolicLink() === true) {
      await fsp.unlink(target).catch(() => fsp.rmdir(target));
    }
  }
}
