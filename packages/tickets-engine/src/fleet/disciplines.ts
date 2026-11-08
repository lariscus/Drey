/**
 * The fixed texts the run briefs end with (`instruction.ts`,
 * `scout-instruction.ts`): the disciplines a worker follows and how it asks
 * the owner. Stable strings — the prompt cache prefix and the brief digest
 * depend on them, so a change here changes every brief.
 */
import { BLOCKED_MARKER, QUESTION_MARKER } from './protocol';

/**
 * The completion discipline every run brief ends with (M85, ADR-0077):
 * step completion is the agent's call — its finished turn is the
 * declaration — and the machine gate is the safety net under it, not an
 * independent mover.
 */
export const COMPLETION_DISCIPLINE =
  'Completion discipline: work the step, then run the gate commands above yourself and fix what they surface. ' +
  'Declare the step done only when every command passes and you consider the work ready — your finished turn is ' +
  'that declaration. After it the runner re-runs the gate: green moves the ticket one column right; a red gate ' +
  'parks the step (the failure is logged and the ticket waits). When you CANNOT complete the step — what blocks ' +
  'it is the owner’s to decide, or completing it would break a rule of this brief — end your final message ' +
  `with \`${BLOCKED_MARKER} <reason in one line>\`: the runner then runs no gate and moves nothing, and the ticket waits ` +
  'for the owner. Never declare done what you did not finish.';

/** The most of an earlier handover the brief carries. */
export const HANDOVER_CAP = 2_000;

/**
 * What a step leaves for the next one and for its own resume: a short
 * structured section instead of long Log lines that every later reader
 * pays for again.
 */
export const HANDOVER_DISCIPLINE =
  "Handover: before you end, replace the ticket file's `## Handover` section (add it before `## Log` if it is " +
  'missing; never a second one) with: State (`done` or `blocked`, one line), Decisions (up to three bullets), Open ' +
  '(what the next step must check first), Files (the main ones), Verified (the commands you ran and their result). ' +
  'Under 15 lines. Log lines stay one short line (under 200 characters) — detail belongs in the handover.';

/**
 * The interactive dialog's discipline (req-65): no gate, no move — the
 * conversation is the deliverable, the owner moves the ticket.
 */
export const INTERACTIVE_DISCIPLINE =
  'Dialog discipline: you are in an interactive dialog with the owner — this is not a dispatched run. Your finished ' +
  'turn does not end anything: the runner runs no gate and moves nothing. Keep working in turns; end a turn with a ' +
  'question when the owner must decide something, and end it with a short statement of what you did and what is ' +
  'open when the step is where you both want it. The owner moves the ticket on the board themselves when the ' +
  'dialog is over — never claim a move happened.';

/**
 * How a worker asks the owner (req-64, the fixed shape since req-75 W2):
 * a turn whose last message opens with the marker does not end the run —
 * the run waits, the owner is notified, and the answer arrives in this
 * same session. The shape lets every surface that answers show the
 * question's context and its options with one tap (`question-shape.ts`).
 */
export const ASKING =
  `Asking the owner: if you cannot go on without a decision only the owner can make, end your turn with a message ` +
  `that starts with \`${QUESTION_MARKER}\` and follows this shape, one item per line: the question; "Ticket:" what ` +
  `the ticket is about in one line; "Where:" where you stand; "Why:" why you ask; "Options:" two to four numbered ` +
  `options, each "<n>. <option> — <its consequence>"; "Recommendation: <n> — <why>". The run then waits, the owner ` +
  `is notified, and their answer arrives here in this session (a picked option arrives as "<n>. <option>"); continue ` +
  `the step from it. Ask only what blocks the step — what the plan, the ticket or the repo already answers, decide ` +
  `yourself; open points that can wait go into the ticket's Log.\n\n` +
  `Example:\n` +
  `${QUESTION_MARKER} Should dragging a heading also move the text below it?\n` +
  `Ticket: Outline — drag headings to reorder the note.\n` +
  `Where: step 2 of 4, the drop handler; step 1 is green.\n` +
  `Why: the plan says "reorder headings" but not whether the section body moves.\n` +
  `Options:\n` +
  `1. Move the whole section — one undo step, what other editors do\n` +
  `2. Only the heading line — the text stays, structure usually breaks\n` +
  `Recommendation: 1 — it keeps the note's structure intact.`;

/**
 * The scout discipline: the deliverable is the `## Report` chapter in the
 * ticket file plus the decision list the owner decides over; the run's end
 * declares the exploration done, nothing gates and nothing moves.
 */
export const SCOUT_DISCIPLINE =
  'Scout discipline: you are on an exploration, not a build — change nothing in any repo: no edits, no commits, no branch, no installs. ' +
  'Read freely: the read ground, its git history, the tickets vault. Your ONE writable place is your own ticket file — the report ' +
  'chapter goes there, nowhere else. End your turn when the exploration is done: the runner runs no gate and moves nothing; the ' +
  'report card waits for the owner in "Needs you", and they promote the ticket to a build ticket from there. When you cannot ' +
  `complete the exploration — a decision only the owner can make, a place you may not read — end your final message with \`${BLOCKED_MARKER} ` +
  '<reason in one line>`: nothing moves, the ticket waits for the owner. Never report what you did not verify.';
