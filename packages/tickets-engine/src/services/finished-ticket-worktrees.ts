import { branchForTicket, type RepoRef, type TicketCard } from '../contracts/tickets';
import { finishedLines, type FinishedTarget, type FinishedWorktrees } from '../fleet/worktrees/finished-worktrees';
import { worktreePathFor } from '../fleet/worktrees/worktree-home';

/** The ticket's worktrees on the board's repositories: its repo first, then its further repos (req-72); none without a local path. */
export function finishedTargetsOf(vaultPath: string, repos: readonly RepoRef[], card: TicketCard): readonly FinishedTarget[] {
  const names = card.meta.repo === null ? [] : [card.meta.repo, ...card.meta.repos.filter((name) => name !== card.meta.repo)];
  return names.flatMap((name) => {
    const repo = repos.find((r) => r.name === name);
    return repo === undefined || repo.path === null ? [] : [{ repoPath: repo.path, worktreePath: worktreePathFor(vaultPath, repo, card.id), links: repo.link ?? [] }];
  });
}

/**
 * The engine's half of req-185: a ticket the engine books into Done (the
 * owner's last Accept, a chain that is through, the archive) leaves no
 * worktree behind. A live run on the ticket keeps them all; the outcome is
 * the owner's warning, null when nothing was kept.
 */
export async function removeDoneWorktrees(input: {
  readonly finished: FinishedWorktrees;
  readonly vaultPath: string;
  readonly repos: readonly RepoRef[];
  readonly card: TicketCard;
  readonly liveRun: boolean;
}): Promise<string | null> {
  const targets = finishedTargetsOf(input.vaultPath, input.repos, input.card);
  if (targets.length === 0) {
    return null;
  }
  if (input.liveRun) {
    return 'A run is live on the ticket — the worktree was kept';
  }
  const report = await input.finished.removeAll(targets);
  const kept = finishedLines({ removed: [], kept: report.kept }, input.card.meta.branch ?? branchForTicket(input.card.id));
  return kept.length === 0 ? null : kept.join('; ');
}
