/**
 * Which runs are reviews (req-183): they read the ticket branch in a
 * read-only checkout of their own instead of the builder's worktree. The
 * rule, one place: the standard `review` phase, and any run whose resolved
 * persona has the role `reviewer` — so an inserted gate (`insert
 * security(ralf) after review`) reviews like the standard one when its
 * persona is a reviewer. A scout run and an owner's dialog never are.
 */

/** The standard flow's review phase id. */
export const REVIEW_PHASE_ID = 'review';

/** The persona role that makes any gate a review. */
export const REVIEWER_ROLE = 'reviewer';

export interface ReviewRunInput {
  /** The working phase's id (the column whose step the run works). */
  readonly phaseId: string;
  /** The resolved persona's role; null/absent on ring dispatches. */
  readonly personaRole?: string | null;
  readonly scout: boolean;
  readonly interactive: boolean;
}

export function isReviewRun(input: ReviewRunInput): boolean {
  if (input.scout || input.interactive) {
    return false;
  }
  return input.phaseId === REVIEW_PHASE_ID || input.personaRole === REVIEWER_ROLE;
}

/** The persona role whose runs judge and change nothing, like a review (req-280). */
export const TESTER_ROLE = 'tester';

/** A run that changes no file: a review (its checkout and session are read-only) or a tester's run. */
export function isReadOnlyRun(input: { readonly reviewCheckout?: string; readonly personaRole?: string | null }): boolean {
  return input.reviewCheckout !== undefined || input.personaRole === TESTER_ROLE;
}
