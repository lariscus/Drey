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
  - { id: inbox, title: Inbox }
  - { id: prioritized, title: Prioritized }
  - { id: done, title: Done }
flow: ${STANDARD_FLOW_LINE}
---
${LIFECYCLE_PIPELINE_PROSE}`;
