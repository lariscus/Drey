/**
 * The persona board's pipeline (req-307, ADR-0098): what "Initialize board" writes into
 * `_meta/pipeline.md` — the three lifecycle columns and the standard flow.
 *
 * The titles here are the pipeline's `title:` values, stored data like the ids.
 */

/** Column ids of the phase board, read by the Work panel's renderer until its phase-board branches go (req-307 step 4 follow-up). */
export const SHAPING_STATE = 'shaping';
export const BUILDING_STATE = 'building';
export const READY_STATE = 'ready';

/** The standard flow of the shipped crew (concept §2): Paul shapes with the owner and then plans (one entry), Ben builds, Ralf reviews, Tessa tests, You accept. */
export const STANDARD_FLOW_LINE = 'paul:shape; ben; ralf; tessa; you';

/**
 * The prose of the shipped PHASE-board pipeline. Nothing writes it any more; the board migration
 * (`core/board-migration.ts`, removed by req-307 step 5) compares a board's body against it.
 */
export const PIPELINE_PROSE = `The pipeline: ordered phases (first = capture target, last = terminal),
configurable per handover (manual | agent <prompt-ref> | ci | none).
Inbox, Shaping and Prioritized are the owner's columns; the fleet takes
nothing from them, the owner moves a ticket into Building. Building is the
one agent column: plan, build, review and test are phases of the chain
inside it. Ready to try is the owner's checkpoint: Accept there is the
sign-off. It starts the commit step on the target repository (merge the
ticket's branch, push); when that is green the ticket lands in Done. See
specs/ticket-schema.md. Edit freely; the board follows on refresh.
`;

/** What a new board's `_meta/pipeline.md` says besides its phases. Prose for humans; the board reads only the frontmatter. */
export const LIFECYCLE_PIPELINE_PROSE = `The pipeline of a persona board: Inbox, Prioritized and Done are the
ticket's lifecycle columns; between them the board draws one column per
persona of the crew, in the crew's order (\`order:\` in crew.md). What a ticket
goes through is its chain, copied from \`flow:\` when it is created. See
specs/ticket-schema.md. Edit freely; the board follows on refresh.
`;

/** The `_meta/pipeline.md` "Initialize board" writes: the lifecycle columns and the standard flow. */
export const DEFAULT_PIPELINE_TEXT = `---
phases:
  - { id: inbox, title: Inbox, handover: manual }
  - { id: prioritized, title: Prioritized, handover: manual }
  - { id: done, title: Done, handover: none }
flow: ${STANDARD_FLOW_LINE}
---
${LIFECYCLE_PIPELINE_PROSE}`;
