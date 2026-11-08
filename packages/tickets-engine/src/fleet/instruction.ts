// ---------------------------------------------------------------------------
// The instruction the worker receives (T-0048: the context pack — stable
// parts first so the prompt prefix stays identical across runs, variable
// parts last).

import type { FleetCaps, InteractiveMode } from './protocol';
import { ASKING, COMPLETION_DISCIPLINE, HANDOVER_DISCIPLINE, INTERACTIVE_DISCIPLINE } from './disciplines';
import { briefHead, headParts, personaLine, type ComposedInstruction, type Truncation } from './instruction-parts';
import { changingParts, whoAndWhere } from './instruction-sections';

export interface InstructionInput {
  readonly ticketId: string;
  readonly title: string;
  readonly repo: string | null;
  readonly branch: string;
  readonly worktreePath: string;
  readonly phase: string;
  readonly description: string;
  readonly plan: string | null;
  readonly prompt: string | null;
  readonly acceptance: readonly string[];
  /**
   * Absolute path of the ticket file in the tickets repo (outside the
   * worktree). Named in the brief so the worker never has to hunt the
   * disk for it — a plan-phase worker spent most of a run doing that.
   */
  readonly ticketFile?: string;
  /**
   * The ticket lives in a store (D-30): `ticketFile` is the run's working
   * copy, whose changes the runner takes back; the brief says so, or a worker
   * looks for the real file.
   */
  readonly ticketFileIsCopy?: boolean;
  /**
   * The work repo's agent instructions (`CLAUDE.md` preferred,
   * `AGENTS.md` fallback), read by the caller: inlined VERBATIM as the
   * instruction's first section, never capped — the CLI's own auto-load
   * differs by provider and version and cannot be the cache-stability
   * anchor.
   */
  readonly repoInstructions: string | null;
  /**
   * The earlier step's `## Handover` section of the ticket (State,
   * Decisions, Open, Files, Verified) — what a next step or a resumed
   * run reads first instead of the Log tail. Empty/absent on a ticket
   * no step has handed over yet.
   */
  readonly handover?: string;
  /** The worktree's raw diff stat vs the base (`worktreeDiffStat`); capped here (head). */
  readonly diffStat: string | null;
  /** The previous run's raw gate failure; capped here (tail). */
  readonly gateFailure: string | null;
  /** The output caps; the caller resolves them from `fleet.cap.*`. */
  readonly caps: FleetCaps;
  /** The repo's `link:` folders the runner links into the worktree (req-56). */
  readonly links?: readonly string[];
  /**
   * The ticket's further repos (req-72), primary excluded: one worktree
   * each on the same branch, prepared before the run. Named in the brief
   * so the worker never hunts for the checkouts.
   */
  readonly extraRepos?: readonly {
    readonly name: string;
    readonly worktreePath: string;
    /** The base the worktree branches from (repos.md `branch:`); null = HEAD. */
    readonly base: string | null;
  }[];
  /**
   * An interactive dialog (req-65): the brief's completion discipline is
   * replaced by the dialog discipline — no gate, no move, the owner moves
   * the ticket.
   */
  readonly interactive?: InteractiveMode;
  /**
   * The resolved persona's skills as one section (D-46): stable like the
   * persona's prompt, so it rides right behind it and a changed skill changes
   * the digest. Null/absent = no section, byte-identical briefs.
   */
  readonly skillsSection?: string | null;
  /**
   * The resolved persona's curated memory, already sliced by
   * `context-pack`'s `personaMemorySection` (E3, ADR-0088): carried as the
   * first of the instruction's variable parts — the stable prefix
   * (instructions, prompt, plan) must not move with the persona's lessons.
   * Null/absent = no section, byte-identical persona-less briefs.
   */
  readonly memorySection?: string | null;
  /**
   * The resolved persona's id and role (D-60): the brief names them so
   * the step prompt's persona-bound asks (the Friction line) can run —
   * the scout brief always did, the ship brief never. Null/absent = a
   * ring run, no line.
   */
  readonly personaId?: string | null;
  readonly personaRole?: string | null;
}

/**
 * Composes the run's instruction as a context pack (T-0048), in this
 * order — stable first, so the prefix up to the `## Plan` heading is
 * byte-identical for any two runs of the same repo and phase:
 *
 * 1. the repo's agent instructions, verbatim;
 * 2. the phase instruction template (a resolved persona's prompt rides
 *    here — it IS the template for its runs);
 * 3. `## Plan` verbatim;
 * 4. the variable parts: who/where, the description, the persona's
 *    `## Memory` slice (E3), the earlier step's handover, the diff stat
 *    (head-capped), the previous run's gate failure on a retry
 *    (tail-capped), the gate commands, the completion discipline and
 *    how to ask the owner.
 *
 * Deterministic text — no model involved; the capping is reported, never
 * marked inside the text (bookkeeping the model does not need).
 */
export function composeInstruction(input: InstructionInput): ComposedInstruction {
  const head = briefHead(input);
  const persona = personaLine(input.personaId, input.personaRole);
  const description = input.description.trim();
  const truncations: Truncation[] = [];
  // The parts that change between runs of one step — the tail of the full
  // brief and the whole of a resume's continuation (req-80).
  const changing = changingParts(input, truncations);
  const closing = closingParts(input);
  const parts = [...headParts(head), ...whoAndWhere(input, { persona, plan: head.plan, description }), ...changing, ...closing, ASKING];
  const continuation = [resumeLine(input), ...changing, ...closing].join('\n\n');
  const stable = JSON.stringify([
    head.repoInstructions,
    head.prompt,
    head.plan,
    description,
    input.acceptance,
    input.interactive ?? null,
    input.worktreePath,
    input.branch,
    ...(head.skills !== '' ? [head.skills] : []),
    ...(persona !== null ? [persona] : []),
  ]);
  return { text: parts.join('\n\n'), truncations, continuation, stable };
}

/** The gate commands (when any), the discipline and — outside a dialog — the handover discipline. */
function closingParts(input: InstructionInput): string[] {
  const parts: string[] = [];
  if (input.acceptance.length > 0) {
    parts.push(
      'The machine gate runs exactly these after you finish — keep them green, and commit your work on the branch before you end:\n' +
        input.acceptance.map((command) => `- \`${command}\``).join('\n'),
    );
  }
  if (input.interactive !== undefined) {
    parts.push(INTERACTIVE_DISCIPLINE);
  } else {
    parts.push(COMPLETION_DISCIPLINE, HANDOVER_DISCIPLINE);
  }
  return parts;
}

/** A resumed session's opening line (req-80). */
function resumeLine(input: InstructionInput): string {
  return (
    `You are resuming ticket ${input.ticketId} — ${input.title}, the "${input.phase}" step, in this same session. ` +
    `Your full brief for this step is earlier in this conversation and still holds — do not re-read what it ` +
    `already told you. Work checkout: ${input.worktreePath} (branch ${input.branch}). Continue where you stopped — ` +
    `do not start the step over; what is already committed or written down stands.`
  );
}
