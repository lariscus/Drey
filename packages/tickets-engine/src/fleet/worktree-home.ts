/**
 * Where fleet worktrees live (T-0044, ADR-0080): one visible base folder
 * per work repo, default `<ticketsRepo>/_worktrees/<ticket-id>/` — a
 * sibling of `tickets/` at the repo root, no longer hidden under the
 * machine-local fleet root. `_`-prefixed root folders are reserved: the
 * vault's file tree, md index and watcher skip them, and the repo's
 * .gitignore covers the base (ensured by the boot sweep). A repo may
 * override its base with a `worktrees:` key in _meta/repos.md — an
 * absolute path, or one relative to the tickets repo root.
 *
 * Pure: no filesystem access, no git — the path discipline only.
 */
import * as path from 'node:path';
import type { RepoRef } from '../contracts/tickets';
import { normalizeForMatch } from './worktrees';

/** The reserved root folder holding the fleet's worktrees by default. */
export const WORKTREES_DIR = '_worktrees';

/**
 * The repo's worktree base folder: the `worktrees:` override when set
 * (relative values resolve against the tickets repo root), else
 * `<ticketsRepo>/_worktrees`.
 */
export function worktreeBaseFor(vaultPath: string, repo: RepoRef): string {
  const override = repo.worktrees?.trim() ?? '';
  if (override !== '') {
    return path.resolve(vaultPath, override);
  }
  return path.join(vaultPath, WORKTREES_DIR);
}

/**
 * The worktree folder name: the bare ticket id — ids are minted
 * board-wide and each ticket names exactly one repo, so a repo prefix
 * buys nothing (ADR-0080).
 */
export function worktreeFolderName(ticketId: string): string {
  return ticketId;
}

/** The worktree's absolute path for one ticket on one repo. */
export function worktreePathFor(vaultPath: string, repo: RepoRef, ticketId: string): string {
  return path.join(worktreeBaseFor(vaultPath, repo), worktreeFolderName(ticketId));
}

/** The reserved root folder holding the workers' ticket copies (req-183). */
export const WORKCOPY_DIR = '_workcopy';

/**
 * A store ticket's working copy for the run that holds it (D-30): in its
 * own reserved root folder since req-183, so a working copy is never
 * mistaken for a git worktree; gitignored, skipped by the vault's tree.
 * One per ticket, as one run holds a ticket.
 */
export function ticketCopyPathFor(vaultPath: string, ticketId: string): string {
  return path.join(vaultPath, WORKCOPY_DIR, `${ticketId}.ticket.md`);
}

/**
 * Where the working copy lived before req-183 (`_worktrees/<id>.ticket.md`).
 * Read for one release only: the runner migrates a copy found there into
 * `_workcopy/` on its first read (`WorkcopyFiles`). Removed by req-200.
 */
export function legacyTicketCopyPathFor(vaultPath: string, ticketId: string): string {
  return path.join(vaultPath, WORKTREES_DIR, `${ticketId}.ticket.md`);
}

/** The suffix of a review checkout's folder beside the ticket's worktree (req-183). */
export const REVIEW_CHECKOUT_SUFFIX = '-review';

/**
 * The review phase's read-only checkout of the ticket branch (req-183): a
 * second git worktree beside the ticket's own, `<id>-review`, detached at
 * the commit the builder handed over. Ticket ids never end in `-review`,
 * so the two names cannot collide.
 */
export function reviewCheckoutPathFor(vaultPath: string, repo: RepoRef, ticketId: string): string {
  return path.join(worktreeBaseFor(vaultPath, repo), `${worktreeFolderName(ticketId)}${REVIEW_CHECKOUT_SUFFIX}`);
}

/** Whether a worktree path is a review checkout (its folder name ends in `-review`). */
export function isReviewCheckoutPath(p: string): boolean {
  return path.basename(p.replace(/[\\/]+$/, '')).endsWith(REVIEW_CHECKOUT_SUFFIX);
}

/**
 * The pre-T-0044 base (`<fleetRoot>/worktrees`) with its
 * `<repo>-<ticket>` folder names. Never written again; the boot
 * migration and the Clean up button empty it (live runs keep theirs
 * until they settle).
 */
export function legacyWorktreeBase(fleetRoot: string): string {
  return path.join(fleetRoot, 'worktrees');
}

/**
 * Whether `p` is `base` itself or a path under it — normalized and
 * case-folded on win32 (porcelain prints `C:/…`, `path.join` yields
 * backslashes), the `worktrees.ts` compare discipline.
 */
export function isUnderAnyBase(p: string, bases: readonly string[]): boolean {
  const needle = normalizeForMatch(p);
  return bases.some((base) => {
    const hay = normalizeForMatch(base);
    return needle === hay || needle.startsWith(`${hay}/`);
  });
}
