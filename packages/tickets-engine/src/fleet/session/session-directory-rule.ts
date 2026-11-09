/**
 * Where a free session may work (req-173, R12): the directory the owner
 * names, checked once before the request is built. Any existing local
 * folder is allowed — **the tickets vault itself included** (it is a git
 * repository like any other) — except what would collide: a folder inside
 * a `.git` directory, a network share, and the worktree of a live ticket
 * run (two workers in one checkout). Pure over the facts the caller
 * gathered; the IO stays with the caller.
 */

/** What the caller found out about the directory and the runner. */
export interface DirectoryFacts {
  /** True = a folder, false = something else, null = nothing there. */
  readonly isDirectory: boolean | null;
  /** The tickets repository's root (absolute). */
  readonly ticketsVault: string;
  /** The worktrees of the live ticket runs (absolute). */
  readonly liveWorktrees: readonly string[];
}

export type DirectoryVerdict = { readonly ok: true; readonly directory: string; readonly ticketsVault: boolean } | { readonly ok: false; readonly error: string };

const ABSOLUTE = /^([a-zA-Z]:[\\/]|\/)/;

/** Lower case, forward slashes, no trailing slash: how two Windows paths compare. */
export function normalizedPath(dir: string): string {
  return dir.trim().replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
}

function inside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

export class SessionDirectoryRule {
  check(dir: string, facts: DirectoryFacts): DirectoryVerdict {
    const stripped = dir.trim().replace(/[\\/]+$/, '');
    const directory = stripped === '' || /^[a-zA-Z]:$/.test(stripped) ? dir.trim() : stripped;
    if (directory === '') {
      return { ok: false, error: 'a free session names its directory' };
    }
    if (directory.startsWith('\\\\') || directory.startsWith('//')) {
      return { ok: false, error: `${directory} is a network share — a session works in a local folder` };
    }
    if (!ABSOLUTE.test(directory)) {
      return { ok: false, error: `${directory} is not an absolute path` };
    }
    if (facts.isDirectory !== true) {
      return { ok: false, error: facts.isDirectory === null ? `${directory} does not exist` : `${directory} is not a folder` };
    }
    const norm = normalizedPath(directory);
    if (norm.split('/').includes('.git')) {
      return { ok: false, error: `${directory} is inside a .git folder` };
    }
    const busy = facts.liveWorktrees.find((worktree) => inside(norm, normalizedPath(worktree)));
    if (busy !== undefined) {
      return { ok: false, error: `${directory} is the worktree of a live run (${busy}) — pick another folder or wait for the run` };
    }
    return { ok: true, directory, ticketsVault: norm === normalizedPath(facts.ticketsVault) };
  }
}
