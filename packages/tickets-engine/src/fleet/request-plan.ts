import path from 'node:path';
import { branchForTicket } from '../contracts/tickets';
import type { ComposeRunInput } from './request';
import type { ExtraRepos } from './request-repos';
import { isReviewRun } from './review-run';
import { reviewCheckoutPathFor, ticketCopyPathFor, worktreePathFor } from './worktree-home';

/** What the checks settled: the input, the ticket's form, the gate's commands, the further repos. */
export interface RunBasis {
  readonly input: ComposeRunInput;
  readonly scout: boolean;
  readonly acceptance: readonly string[];
  readonly extras: ExtraRepos;
}

/** The run's resolved ground, from which both the instruction and the request are built. */
export interface RunPlan extends RunBasis {
  readonly branch: string;
  readonly readGround: string;
  readonly worktreePath: string;
  readonly ticketFile: string;
  /** Whether a green gate moves the ticket on. */
  readonly moves: boolean;
  /** req-183: the review run's read-only checkout; null on every other run. */
  readonly reviewCheckout: string | null;
}

export function planRun(basis: RunBasis): RunPlan {
  const { input, scout } = basis;
  // The scout run's directory is its read ground — the named repo's
  // checkout, else the tickets vault — computed here and carried on the
  // request like the worktree home (ADR-0080): the runner never derives
  // paths, and the brief names the absolute location so the worker never
  // has to find it. No worktree is ever prepared there.
  const readGround = input.repo?.path ?? input.vaultPath;
  return {
    ...basis,
    branch: input.card.meta.branch ?? branchForTicket(input.card.id),
    readGround,
    worktreePath: scout ? readGround : worktreePathFor(input.vaultPath, input.repo!, input.card.id),
    ticketFile: ticketFileOf(input),
    // A scout run never gates and never moves (concept §5.6) — the same
    // move-target rule as an interactive dialog: the ticket stays where it
    // sits until the owner promotes it from the report card.
    moves: !scout && input.interactive === undefined,
    reviewCheckout: reviewCheckoutOf(input, scout),
  };
}

/** req-183: a review run reads the branch in `<id>-review` beside the ticket's worktree. */
function reviewCheckoutOf(input: ComposeRunInput, scout: boolean): string | null {
  const review = isReviewRun({
    phaseId: input.workingPhase?.id ?? input.card.phase,
    personaRole: input.persona?.role ?? null,
    scout,
    interactive: input.interactive !== undefined,
  });
  return review && input.repo !== null ? reviewCheckoutPathFor(input.vaultPath, input.repo, input.card.id) : null;
}

/** D-30: a store card's path is virtual, no such file exists: the worker gets a copy the runner takes back. */
function ticketFileOf(input: ComposeRunInput): string {
  return input.dk !== undefined ? ticketCopyPathFor(input.vaultPath, input.card.id) : path.join(input.vaultPath, input.card.path);
}
