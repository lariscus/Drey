/**
 * Which `repos.md` entry a recognised checkout is (req-304): the entry that
 * already names this very checkout, else a new one under the folder's name —
 * `-2`, `-3`… when another checkout already holds that name. Pure; the
 * recognition itself is `services/folder-probe.ts`.
 */
import type { RepoRef } from '../contracts/repo-ref';

/** What the probe read of a checkout. */
export interface RepoSeed {
  readonly name: string;
  /** The `origin` url; the checkout's own path when it has no remote. */
  readonly url: string;
  readonly branch: string | null;
  /** The checkout's root, as git reports it. */
  readonly path: string;
}

export interface RepoChoice {
  /** The name the project lists. */
  readonly name: string;
  /** The entry `repos.md` gains; null when an existing entry already is this checkout. */
  readonly add: RepoRef | null;
}

/** A checkout path compared without separators, trailing slash or (on a drive path) case. */
export function sameCheckoutPath(a: string, b: string): boolean {
  const norm = (p: string): string => {
    const slashed = p.trim().replace(/\\/g, '/').replace(/\/+$/, '');
    return /^[a-z]:/i.test(slashed) ? slashed.toLowerCase() : slashed;
  };
  return norm(a) === norm(b);
}

function freeName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) {
    return base;
  }
  let n = 2;
  while (taken.has(`${base}-${n}`)) {
    n += 1;
  }
  return `${base}-${n}`;
}

export function chooseRepoEntry(repos: readonly RepoRef[], seed: RepoSeed): RepoChoice {
  const same = repos.find((r) => (r.path !== null ? sameCheckoutPath(r.path, seed.path) : r.url === seed.url));
  if (same !== undefined) {
    return { name: same.name, add: null };
  }
  const name = freeName(seed.name, new Set(repos.map((r) => r.name)));
  return {
    name,
    add: { name, url: seed.url, branch: seed.branch, policy: null, path: seed.path, worker: null, worktrees: null, launch: null, instructions: null },
  };
}
