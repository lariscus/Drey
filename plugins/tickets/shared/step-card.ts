/**
 * Which card a ticket's thread shows at the end of a step, and what it
 * offers — pure, so the rule is specced without a DOM.
 *
 * The card follows the ticket's place in the pipeline:
 *
 * - `gate`: the ticket waits at a checkpoint of the owner (a needs-you
 *   row without a live run). The card reports what the step did and
 *   offers the gate's moves — launch the build when one can run, move
 *   on, send back.
 * - `final`: the ticket sits in the terminal column. The step is over
 *   and merged; the card is the closing report and offers only Archive.
 * - `none`: an agent works the ticket, or there is nothing to report.
 */
export type StepCardKind = 'gate' | 'final' | 'none';

export interface StepCardInput {
  /** The pipeline in order, with each column's title. */
  readonly pipeline: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  /** The column the ticket sits in. */
  readonly phaseId: string;
  /** The ticket is at a checkpoint of the owner (no live run). */
  readonly atCheckpoint: boolean;
  /** The ticket file carries a `## Changes` or `## Result` section. */
  readonly hasReport: boolean;
  /** A worktree exists and a launch command resolves. */
  readonly launchable: boolean;
}

export interface StepCard {
  readonly kind: StepCardKind;
  /** The primary move's label: `Move to Review`, `Archive`. Empty for `none`. */
  readonly acceptLabel: string;
  /** Offer "Launch this version". */
  readonly canLaunch: boolean;
  /** Offer "Send back…". */
  readonly canSendBack: boolean;
}

const NONE: StepCard = { kind: 'none', acceptLabel: '', canLaunch: false, canSendBack: false };

export function stepCardOf(input: StepCardInput): StepCard {
  const at = input.pipeline.findIndex((p) => p.id === input.phaseId);
  if (at < 0) {
    return NONE;
  }
  if (at === input.pipeline.length - 1) {
    return input.hasReport ? { kind: 'final', acceptLabel: 'Archive', canLaunch: false, canSendBack: false } : NONE;
  }
  if (!input.atCheckpoint) {
    return NONE;
  }
  const next = input.pipeline[at + 1]!;
  return {
    kind: 'gate',
    acceptLabel: `Move to ${next.title}`,
    canLaunch: input.launchable,
    canSendBack: at > 0,
  };
}
