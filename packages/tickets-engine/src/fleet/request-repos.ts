import type { RepoRef } from '../contracts/tickets';
import type { ComposeRunInput } from './request';
import { worktreePathFor } from './worktree-home';

/** A further repo's worktree on the ticket's branch, prepared before a ship run (req-72). */
export interface ExtraWorktree {
  name: string;
  repoPath: string;
  worktreePath: string;
  baseRef: string | null;
  links?: readonly string[];
}

/** A further repo a scout run reads in place. */
export interface ExtraReadGround {
  name: string;
  path: string;
}

/** The ticket's further repos, split by what the run does with them. */
export interface ExtraRepos {
  readonly worktrees: readonly ExtraWorktree[];
  readonly readGrounds: readonly ExtraReadGround[];
}

export type ExtraReposResult = ({ readonly ok: true } & ExtraRepos) | { readonly ok: false; readonly error: string };

/**
 * req-72: every extra repo needs a checkout too — the fleet prepares
 * one worktree per repo before a ship run starts. A scout run reads
 * them in place instead: named read grounds, never a prepared tree.
 */
export function resolveExtraRepos(input: ComposeRunInput, scout: boolean): ExtraReposResult {
  const repo = input.repo;
  const worktrees: ExtraWorktree[] = [];
  const readGrounds: ExtraReadGround[] = [];
  for (const extra of input.extraRepos ?? []) {
    if (repo !== null && extra.name === repo.name) {
      continue; // the primary twice would prepare one worktree twice
    }
    if (extra.path === null) {
      return { ok: false, error: missingPathError(extra, repo) };
    }
    if (scout) {
      readGrounds.push({ name: extra.name, path: extra.path });
    } else {
      worktrees.push(extraWorktree(input, extra, extra.path));
    }
  }
  return { ok: true, worktrees, readGrounds };
}

function missingPathError(extra: RepoRef, repo: RepoRef | null): string {
  return `"${extra.name}" has no local path: in _meta/repos.md — the ticket names it beside ${repo?.name ?? 'no primary repo'}`;
}

function extraWorktree(input: ComposeRunInput, extra: RepoRef, repoPath: string): ExtraWorktree {
  return {
    name: extra.name,
    repoPath,
    worktreePath: worktreePathFor(input.vaultPath, extra, input.card.id),
    baseRef: extra.branch,
    ...(extra.link !== undefined && extra.link.length > 0 ? { links: [...extra.link] } : {}),
  };
}
