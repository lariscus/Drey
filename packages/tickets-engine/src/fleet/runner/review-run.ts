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

/**
 * A run whose brief carries the read-only rules: a review (its checkout and
 * session are read-only) or a run of a persona instructed read-only
 * (`readonly:` on the record, else the reviewer's and the tester's role
 * default — req-258; instructed, the harness session keeps its permissions).
 */
export function isReadOnlyRun(input: { readonly reviewCheckout?: string; readonly readOnly?: boolean }): boolean {
  return input.reviewCheckout !== undefined || input.readOnly === true;
}
