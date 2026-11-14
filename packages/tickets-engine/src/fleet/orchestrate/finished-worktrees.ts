import type { RunRequest } from '../protocol';

/** One worktree a finished ticket leaves behind: the repository it belongs to and the checkout. */
export interface FinishedTarget {
  readonly repoPath: string;
  readonly worktreePath: string;
  /** `repos.md` `link:` — the junctions go before git's removal. */
  readonly links: readonly string[];
}

/** What one removal did: gone, kept because it is dirty, or kept because git refused. */
export type RemovalOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly dirty: true }
  | { readonly ok: false; readonly dirty?: undefined; readonly error: string };

/** The git and the file system the removal drives (`GitWorktreeRemover` in production). */
export interface WorktreeRemover {
  exists(worktreePath: string): Promise<boolean>;
  /** `git worktree remove` without `--force`: a dirty tree is refused, never destroyed. */
  remove(target: FinishedTarget): Promise<RemovalOutcome>;
}

/** What became of a finished ticket's worktrees. */
export interface FinishedReport {
  readonly removed: readonly string[];
  readonly kept: readonly { readonly path: string; readonly reason: string }[];
}

/** The request's own worktree and its further repositories' (req-72), in that order. */
export function targetsOfRequest(request: Pick<RunRequest, 'repoPath' | 'worktreePath' | 'links' | 'extraRepos'>): readonly FinishedTarget[] {
  return [
    { repoPath: request.repoPath, worktreePath: request.worktreePath, links: request.links ?? [] },
    ...(request.extraRepos ?? []).map((extra) => ({ repoPath: extra.repoPath, worktreePath: extra.worktreePath, links: extra.links ?? [] })),
  ];
}

/** The report as the run's notes and the owner's warning say it; empty when nothing was there. */
export function finishedLines(report: FinishedReport, branch: string): readonly string[] {
  return [
    ...report.removed.map((p) => `worktree removed: ${p} (the branch ${branch} stays)`),
    ...report.kept.map((k) => `worktree kept: ${k.path} — ${k.reason}`),
  ];
}

/**
 * A finished ticket's worktrees go (req-185, owner 2026-11-14): after its
 * merge or its move into Done, every checkout of the ticket is removed with
 * real git — the branch stays, it carries the work; a dirty tree is kept and
 * reported, never forced; a folder that is not there is nothing to do. The
 * one rule for the commit run's green end and the engine's Done moves, so
 * worktrees stop piling up between the owner's "Clean up worktrees".
 */
export class FinishedWorktrees {
  constructor(private readonly remover: WorktreeRemover) {}

  async removeAll(targets: readonly FinishedTarget[]): Promise<FinishedReport> {
    const removed: string[] = [];
    const kept: { path: string; reason: string }[] = [];
    for (const target of targets) {
      if (!(await this.remover.exists(target.worktreePath).catch(() => false))) {
        continue;
      }
      const outcome: RemovalOutcome = await this.remover.remove(target).catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }));
      if (outcome.ok) {
        removed.push(target.worktreePath);
      } else {
        kept.push({ path: target.worktreePath, reason: outcome.dirty === true ? 'it has uncommitted changes' : outcome.error });
      }
    }
    return { removed, kept };
  }
}
