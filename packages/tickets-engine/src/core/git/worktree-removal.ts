/**
 * The pure planner behind "Remove worktree" (T-0042): decides — from the
 * board alone — whether the `_worktrees/<id>` folder the Files context
 * menu was opened on MAY be removed, and which repository checkout runs
 * the `git worktree remove`. The main-side handler executes the plan
 * (`TicketsGit.worktreeRemove`); nothing here touches the disk.
 *
 * `_worktrees/<id>` at the repo root is the worktree home (T-0044). A
 * review checkout `_worktrees/<id>-review` (req-183) is not matched: the
 * runner removes it when the review ends, Clean up removes a leftover. The
 * workers' ticket copies live in `_workcopy/` (req-183), never here.
 */
import type { RepoRef, TicketCard } from '../../contracts/tickets';

/** Where fleet worktrees live, relative to the tickets vault's root. */
export const WORKTREES_DIR = '_worktrees';

/** `_worktrees/T-0042` (optionally a path inside it) — the id names the ticket. */
const WORKTREE_FOLDER = new RegExp(`^${WORKTREES_DIR}/(T-\\d{4,})(?:/.*)?$`);

/** What the Files-panel target checks against, plus the repo resolution. */
export interface WorktreeRemovalInput {
  /** The context-menu target's vault-relative path: `_worktrees/<id>[/…]`. */
  readonly folder: string;
  /** Board cards — the run stamps decide whether a worktree is busy. */
  readonly cards: readonly TicketCard[];
  /** `tickets/_meta/repos.md`, with the local checkout paths. */
  readonly repos: readonly RepoRef[];
}

export type WorktreeRemovalPlan =
  | { readonly ok: true; readonly repoPath: string }
  | { readonly ok: false; readonly error: string };

export function planWorktreeRemoval(input: WorktreeRemovalInput): WorktreeRemovalPlan {
  const match = WORKTREE_FOLDER.exec(input.folder);
  if (match === null) {
    return {
      ok: false,
      error: `"${input.folder}" is not a worktree folder under ${WORKTREES_DIR}/.`,
    };
  }
  const id = match[1]!;
  const card = input.cards.find((c) => c.id === id) ?? null;
  if (card === null) {
    return { ok: false, error: `${id} is not on the board — its worktree is not ours to remove.` };
  }
  if (card.meta.run !== null) {
    return { ok: false, error: `a fleet run is active for ${id} — stop the run first.` };
  }
  if (card.meta.repo === null) {
    return { ok: false, error: `${id} names no repository.` };
  }
  const repo = input.repos.find((r) => r.name === card.meta.repo) ?? null;
  if (repo === null) {
    return { ok: false, error: `repo "${card.meta.repo}" is not in _meta/repos.md.` };
  }
  if (repo.path === null) {
    return { ok: false, error: `repo "${repo.name}" has no local path in _meta/repos.md.` };
  }
  return { ok: true, repoPath: repo.path };
}
