/**
 * Worktree cleanup (T-0044, ADR-0080): everything through real git —
 * `git worktree remove` / `git worktree prune` — never a bare rmdir on a
 * registered tree. Removal refuses dirt by default (the branch carries
 * the committed work; dirty content is never destroyed — the same rule
 * as `prepareWorktree`), global cleanup skips protected paths (live
 * runs) and tolerates per-item failure, and orphan folders are listed,
 * never deleted.
 */
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { Dirent } from 'node:fs';
import type { RepoRef } from '../../contracts/tickets';
import type { TicketsGit } from '../../core/git/tickets-git';
import { NodeTreeMode } from './node-tree-mode';
import { isReviewCheckoutPath, isUnderAnyBase, legacyWorktreeBase, worktreeBaseFor } from './worktree-home';
import { normalizeForMatch, parseWorktreePorcelain, realPathOrNull, unlinkShared } from './worktrees';

/** The exec seam cleanup drives (a `TicketsGit` instance). */
type GitSeam = Pick<TicketsGit, 'run'>;

export interface RemoveOptions {
  /** Skip the dirty refusal — the owner confirmed. Never the default. */
  readonly force?: boolean;
  /** The repo's `link:` folders (repos.md, req-56) — unlinked before the
   *  removal. git's `worktree remove` leaves junctions behind, and a
   *  leftover folder at the path poisons the next prepare (the sweep
   *  catches every top-level reparse point, named or not). */
  readonly links?: readonly string[];
}

export type RemoveOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly dirty: true; readonly status: string }
  | { readonly ok: false; readonly dirty?: undefined; readonly error: string };

/**
 * Removes one registered worktree. `status --porcelain` reads the tree
 * first — a tree that no longer answers to git is an error, not an
 * empty status — then the `link:` junctions go (git's removal leaves
 * them behind; a recursive delete must never reach through them) and
 * `git worktree remove` does the work (`--force` only with `force`).
 * No `fsp.rm` on registered trees.
 */
export async function removeWorktree(
  git: GitSeam,
  repoPath: string,
  worktreePath: string,
  options: RemoveOptions = {},
): Promise<RemoveOutcome> {
  let status: string;
  try {
    status = await git.run(worktreePath, ['status', '--porcelain']);
  } catch (error) {
    return { ok: false, error: `the worktree cannot be inspected: ${messageOf(error)}` };
  }
  if (status.trim() !== '' && options.force !== true) {
    return { ok: false, dirty: true, status };
  }
  try {
    if (isReviewCheckoutPath(worktreePath)) {
      await new NodeTreeMode().setReadOnly(worktreePath, false); // req-183: a leftover review checkout is read-only on disk
    }
    await unlinkShared(worktreePath, options.links ?? []);
    const args = ['worktree', 'remove', ...(options.force === true ? ['--force'] : []), worktreePath];
    await git.run(repoPath, args);
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
  return { ok: true };
}

export interface CleanWorktreesInput {
  /** The board's repos (repos.md); a repo without a local `path:` has no fleet worktrees. */
  readonly repos: readonly RepoRef[];
  /** Absolute path of the tickets vault (the default base's root). */
  readonly vaultPath: string;
  /** The machine-local fleet root (`<userRoot>/fleet`) — the legacy base. */
  readonly fleetRoot: string;
  /** Worktree paths of live runs — never removed. */
  readonly protectedPaths: readonly string[];
  /**
   * The boot migration's scope (T-0044): only the legacy base is
   * cleaned (settled tickets' home trees stay — they are the work
   * surface re-runs reuse). The Clean up button uses the full scope.
   */
  readonly legacyOnly?: boolean;
}

export interface CleanupReport {
  /** Worktree paths removed (real `git worktree remove`). */
  readonly removed: readonly string[];
  /** Paths kept because they are dirty — reported, never destroyed. */
  readonly keptDirty: readonly string[];
  /** Everything that failed; the report continues past it. */
  readonly failed: readonly { readonly path: string; readonly error: string }[];
  /** Repo paths where `git worktree prune` ran. */
  readonly prunedRepos: readonly string[];
  /** Unregistered folders under the bases that held nothing but links
   *  (what an older removal left behind, req-68) — swept. */
  readonly leftovers: readonly string[];
}

/**
 * The global cleanup (the Clean up button) and the boot migration in
 * one rule: per repo, every registered worktree under the repo's new or
 * legacy base that is not protected gets `removeWorktree`'s treatment;
 * then one `git worktree prune` clears the admin entries. The legacy
 * base folder itself is rmdir'd when empty (best effort). Boundaries
 * (bases, protected paths, the repo's own checkout) match through both
 * spellings, the given form and its realpath: git reports the paths it
 * registers canonically while the caller can hold an alias — an 8.3
 * short name, a junction — the `findWorktreeEntry` discipline.
 */
export async function cleanWorktrees(git: GitSeam, input: CleanWorktreesInput): Promise<CleanupReport> {
  const protectedSet = new Set<string>();
  for (const protectedPath of input.protectedPaths) {
    for (const form of await matchForms(protectedPath)) {
      protectedSet.add(form);
    }
  }
  const state: CleanupState = { protectedSet, removed: [], keptDirty: [], failed: [], prunedRepos: [], registered: new Set<string>(), sweepBases: new Set<string>([legacyWorktreeBase(input.fleetRoot)]), links: new Set<string>() };
  for (const repo of input.repos) {
    await cleanRepo(git, input, repo, state);
  }
  const leftovers = await sweepLeftovers([...state.sweepBases], state.registered, protectedSet, [...state.links]);
  await fsp.rmdir(legacyWorktreeBase(input.fleetRoot)).catch(() => undefined);
  return { removed: state.removed, keptDirty: state.keptDirty, failed: state.failed, prunedRepos: state.prunedRepos, leftovers };
}

/** What one cleanup collects across its repos. */
interface CleanupState {
  readonly protectedSet: ReadonlySet<string>;
  readonly removed: string[];
  readonly keptDirty: string[];
  readonly failed: { path: string; error: string }[];
  readonly prunedRepos: string[];
  /** Every match form of a checkout that stays registered (the sweep leaves it alone). */
  readonly registered: Set<string>;
  readonly sweepBases: Set<string>;
  readonly links: Set<string>;
}

/** One repo's registered worktrees, as the cleanup sees them. */
interface RepoScope {
  readonly repoPath: string;
  readonly link: readonly string[] | undefined;
  readonly baseForms: readonly string[];
  readonly repoForms: readonly string[];
}

async function cleanRepo(git: GitSeam, input: CleanWorktreesInput, repo: RepoRef, state: CleanupState): Promise<void> {
  if (repo.path === null) {
    return;
  }
  const legacy = legacyWorktreeBase(input.fleetRoot);
  const bases = input.legacyOnly === true ? [legacy] : [worktreeBaseFor(input.vaultPath, repo), legacy];
  bases.forEach((base) => state.sweepBases.add(base));
  (repo.link ?? []).forEach((link) => state.links.add(link));
  const baseForms = (await Promise.all(bases.map(matchForms))).flat();
  const repoForms = await matchForms(repo.path);
  repoForms.forEach((form) => state.registered.add(form));
  let listing: string;
  try {
    listing = await git.run(repo.path, ['worktree', 'list', '--porcelain']);
  } catch (error) {
    state.failed.push({ path: repo.path, error: `worktree list failed: ${messageOf(error)}` });
    return;
  }
  const scope: RepoScope = { repoPath: repo.path, link: repo.link, baseForms, repoForms };
  for (const entry of parseWorktreePorcelain(listing)) {
    // Prunable entries (vanished trees) are the prune's job.
    if (!entry.prunable) {
      await cleanEntry(git, scope, entry.path, state);
    }
  }
  try {
    await git.run(repo.path, ['worktree', 'prune']);
    state.prunedRepos.push(repo.path);
  } catch (error) {
    state.failed.push({ path: repo.path, error: `prune failed: ${messageOf(error)}` });
  }
}

/** One registered worktree: kept (the repo's own checkout, outside the bases, protected, dirty, failed) or removed. */
async function cleanEntry(git: GitSeam, scope: RepoScope, entryPath: string, state: CleanupState): Promise<void> {
  const entryForms = await matchForms(entryPath);
  const keep = (): void => entryForms.forEach((form) => state.registered.add(form));
  // The repo's own checkout is never a fleet worktree.
  const isRepoCheckout = entryForms.some((form) => scope.repoForms.includes(form));
  if (isRepoCheckout || !entryForms.some((form) => isUnderAnyBase(form, scope.baseForms)) || entryForms.some((form) => state.protectedSet.has(form))) {
    keep();
    return;
  }
  const outcome = await removeWorktree(git, scope.repoPath, entryPath, { links: scope.link });
  if (outcome.ok) {
    state.removed.push(entryPath);
    return;
  }
  keep();
  if (outcome.dirty === true) {
    state.keptDirty.push(entryPath);
  } else {
    state.failed.push({ path: entryPath, error: outcome.error });
  }
}

/**
 * Folders under the bases that git no longer knows and that hold
 * nothing but links (req-68): what a removal left behind before
 * `removeWorktree` unlinked first. The links go (never followed), then
 * a non-recursive rmdir. A folder with any real entry is not touched —
 * it stays listed as an orphan / legacy leftover. Protected paths and
 * `.stale-*` / dot folders are skipped, as in `listOrphans`.
 */
async function sweepLeftovers(
  bases: readonly string[],
  registered: ReadonlySet<string>,
  protectedSet: ReadonlySet<string>,
  links: readonly string[],
): Promise<readonly string[]> {
  const swept: string[] = [];
  for (const base of bases) {
    const entries = await fsp.readdir(base, { withFileTypes: true }).catch(() => [] as Dirent[]);
    for (const dirent of entries) {
      if (!dirent.isDirectory() || dirent.name.startsWith('.') || dirent.name.includes('.stale-')) {
        continue;
      }
      const full = path.join(base, dirent.name);
      const forms = await matchForms(full);
      if (forms.some((form) => registered.has(form) || protectedSet.has(form))) {
        continue;
      }
      if (!(await holdsOnlyLinks(full))) {
        continue;
      }
      await unlinkShared(full, links);
      if (await fsp.rmdir(full).then(() => true, () => false)) {
        swept.push(full);
      }
    }
  }
  return swept.sort();
}

async function holdsOnlyLinks(folder: string): Promise<boolean> {
  const names = await fsp.readdir(folder).catch(() => null);
  if (names === null) {
    return false;
  }
  for (const name of names) {
    const stat = await fsp.lstat(path.join(folder, name)).catch(() => null);
    if (stat?.isSymbolicLink() !== true) {
      return false;
    }
  }
  return true;
}

/**
 * Folders under the bases that no run record (live or historical)
 * names — listed only, never deleted (the boot sweep's report).
 * `.stale-*` move-aside folders are the kept-not-deleted guarantee and
 * dot entries are invisible; neither is an orphan.
 */
export async function listOrphans(
  bases: readonly string[],
  runWorktreePaths: readonly string[],
): Promise<readonly string[]> {
  const known = new Set(runWorktreePaths.map(normalizeForMatch));
  const orphans: string[] = [];
  for (const base of bases) {
    const entries = await fsp.readdir(base, { withFileTypes: true }).catch(() => [] as Dirent[]);
    for (const dirent of entries) {
      if (!dirent.isDirectory() || dirent.name.startsWith('.') || dirent.name.includes('.stale-')) {
        continue;
      }
      const full = path.join(base, dirent.name);
      if (!known.has(normalizeForMatch(full))) {
        orphans.push(full);
      }
    }
  }
  return orphans.sort();
}

/** Both spellings a boundary path can match in, normalized: the given
 *  form and its realpath — git registers and reports canonical paths
 *  while the caller's path can reach the same directory through an
 *  alias (an 8.3 short name, a junction). A path that cannot be
 *  resolved (a base that does not exist yet, a vanished tree) keeps
 *  its given form. */
async function matchForms(p: string): Promise<string[]> {
  const real = await realPathOrNull(p);
  const forms = real === null || real === p ? [p] : [p, real];
  return forms.map(normalizeForMatch);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
