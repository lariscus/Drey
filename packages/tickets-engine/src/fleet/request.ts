/**
 * The one place a RunRequest is built (M85): Drey's board service (an
 * owner-started run) and the runner's orchestrator (a dispatched run)
 * both come through here, so the request they hand the supervisor —
 * worker ladder, model pin, prompt ref, move target, claim identity,
 * and since E8 the ticket's form (a scout ticket composes an
 * exploration, not a build) — cannot drift. Pure: file reads (the
 * prompt text, the ticket text) stay with the caller.
 */
import type { PipelinePhase, RepoRef, TicketCard } from '../contracts/tickets';
import type { ClosingSignal } from '../core/closing-signals';
import type { PersonaRunSettings } from '../core/persona-settings';
import { acceptanceCommands } from '../core/ticket-files';
import type { Truncation } from './assignment';
import type { DisciplineTexts } from './discipline-texts';
import type { FleetCaps, HandoverMode, InteractiveMode, PermissionMode, RunCursor, RunDkTarget, RunRequest } from './protocol';
import { assembleRunRequest } from './request-assemble';
import { composeRunInstruction } from './request-instruction';
import { planRun } from './request-plan';
import { acceptanceRefusal, ownerColumnRefusal, repoRefusal } from './request-refusals';
import { resolveExtraRepos } from './request-repos';
import { resolveRunWorker } from './request-worker';

export { agentIdentity } from './request-assemble';

export interface ComposeRunInput {
  /** Who asks for this run (D-41); it rides the request to the runner's log and record. */
  readonly origin: string;
  readonly card: TicketCard;
  /** The ticket file's full text. */
  readonly ticketText: string;
  /** Absolute path of the tickets vault. */
  readonly vaultPath: string;
  /** The working column's phase config (for an owner run: the phase the
   *  ticket sits in — the two are the same there). */
  readonly workingPhase: PipelinePhase | null;
  /** The move target on a green gate, or null to end the run in place. */
  readonly nextPhaseId: string | null;
  /** The directory the green move writes into (T-0041: resolved against
   *  the dirs on disk, `resolvePhaseDir`); null = the bare phase id. */
  readonly nextPhaseDir: string | null;
  /** pipeline.md's `push:` remote (T-0041); null = never push. */
  readonly pushRemote: string | null;
  /** E10-6: park the ticket for this human persona after a green gate instead of moving it on. */
  readonly parkFor?: string | null;
  /** req-257: the chain entry the run works (a lifecycle store); a green end advances the cursor instead of moving. */
  readonly cursor?: RunCursor;
  /** Whether `nextPhaseId` claims (claim: true) — stamps the agent identity. */
  readonly nextPhaseClaims: boolean;
  readonly repo: RepoRef | null;
  /**
   * The ticket's further work repos (req-72), already resolved and
   * primary-excluded by the caller — one worktree each on the same
   * branch. A repo without a local path is refused here, like the
   * primary's.
   */
  readonly extraRepos?: readonly RepoRef[];
  /** The prompt file's text, when the assignment names one (read by the caller). */
  readonly promptText: string | null;
  readonly defaultWorker: string;
  readonly permissionMode: PermissionMode;
  /** The plugin's gitPath ('' = `git`). */
  readonly gitPath: string;
  /** The run dialog's explicit worker choice (owner runs only). */
  readonly workerChoice: string | null;
  /**
   * The work repo's agent instructions (T-0048 context pack), read by the
   * caller; null = the repo carries none.
   */
  readonly repoInstructions: string | null;
  /** The worktree's raw diff stat (T-0048), read by the caller; null = none. */
  readonly diffStat: string | null;
  /** The previous run's raw gate failure (T-0048 retry), read by the caller; null = a first run. */
  readonly gateFailure: string | null;
  /** The instruction output caps (T-0048); absent = `DEFAULT_FLEET_CAPS`. */
  readonly caps?: FleetCaps;
  /**
   * Set by the orchestrator for the pipeline's first worker column: a
   * ticket entering there carries no acceptance criteria yet (writing
   * them is the plan's job), so the run gates structurally — the gate
   * then checks the criteria came into existence — instead of refusing.
   */
  readonly structuralGateAllowed?: boolean;
  /** Set when the orchestrator dispatches — the pool whose slot this run occupies. */
  readonly dispatchedBy?: string;
  /**
   * The handover ask (T-0049): the start dialog's explicit mode, or
   * 'auto' from the dispatcher — absent (an older caller) means fresh.
   */
  readonly handover?: HandoverMode | 'auto';
  /**
   * The owner drives this run as a dialog (req-65): the acceptance
   * refusal is lifted, the brief's completion discipline becomes the
   * dialog discipline, and the request carries the mode so the runner
   * holds the worker from turn one and never gates or moves.
   */
  readonly interactive?: InteractiveMode;
  /**
   * Accept's run on Ready to try (req-99a): the one run a manual column may carry, besides the owner's
   * dialog (D-29). Since req-267 a machine run — You's `commit` leaving action, no worker, no brief.
   */
  readonly commitStep?: boolean;
  /** E14-5: the ticket lives in a dricket store - the run claims and releases it through `dk`. */
  readonly dk?: RunDkTarget;
  /**
   * The persona the dispatch resolved (E3, ADR-0088) — the ladder's
   * winner, loaded from the vault by the caller; null = the assignment
   * ring decides everything, exactly as before personas.
   */
  readonly persona?: PersonaDispatch | null;
  /**
   * The discipline texts the composed brief ends with (`prompts/disciplines/`,
   * req-279) — loaded once by the dispatching caller (board service or
   * TicketDispatch), so the pure composer reads no files.
   */
  readonly disciplines: DisciplineTexts;
  /** req-169: the vault's closing-round signals (pipeline.md `closing-signals:`); absent = all five. */
  readonly closingSignals?: readonly ClosingSignal[];
}

/**
 * What a resolved persona contributes to a dispatch (E3): the worker
 * harness and model pin (`deriveWorkerModel` with a null context
 * estimate), its prompt as the instruction base instead of the phase
 * handover prompt, and its curated memory for the instruction's
 * `## Memory` slice.
 */
export interface PersonaDispatch {
  /** The persona id — what `RunInfo.persona` stamps and the report groups by. */
  readonly id: string;
  /** The persona's role for the brief's persona line (D-60); absent = id only. */
  readonly role?: string | null;
  /** The harness pin (`opencode` | `claude-code` | `kimi`; anything unreadable leaves the ring in charge). */
  readonly worker: string;
  /** The model pin. */
  readonly model: string;
  /** The persona's prompt text; null/blank = the phase prompt stands. */
  readonly prompt: string | null;
  /** The persona's memory text ('' when the file is absent). */
  readonly memory: string;
  /** The texts of the skills its record names (D-46); absent = none. */
  readonly skills?: readonly { readonly name: string; readonly text: string }[];
  /**
   * req-258: what the run takes from the record — instructed read-only, the
   * hand-over gate, the run ceilings (the role's defaults resolved). Absent =
   * today's behaviour: the column decides.
   */
  readonly run?: PersonaRunSettings;
}

export type ComposeRunResult =
  | {
      readonly ok: true;
      readonly request: RunRequest;
      readonly truncations: readonly Truncation[];
      /**
       * The resolved persona id for the supervisor to stamp on
       * `RunInfo.persona` (null on ring dispatches) — the request itself
       * stays the wire shape it always was.
       */
      readonly persona: string | null;
    }
  | { readonly ok: false; readonly error: string };

export function composeRunRequest(input: ComposeRunInput): ComposeRunResult {
  // A scout ticket (form: scout, E8, concept §5.6) runs an exploration,
  // not a build: no worktree is prepared — the named repo's checkout
  // (else the tickets vault itself) is the run's read ground, the gate
  // is 'none' and nothing moves.
  const scout = (input.card.meta.form ?? 'ship') === 'scout';
  const refusal = ownerColumnRefusal(input) ?? repoRefusal(input, scout);
  if (refusal !== null) {
    return refused(refusal);
  }
  const extras = resolveExtraRepos(input, scout);
  if (!extras.ok) {
    return refused(extras.error);
  }
  // A scout run has no machine gate (concept §5.6) — no acceptance
  // commands are demanded, carried or run.
  // req-258: a persona whose gate is structural (a planner) is judged by what it wrote, never by the build's commands.
  const acceptance = scout || structuralGate(input) ? [] : acceptanceCommands(input.ticketText);
  const gateRefusal = acceptanceRefusal(input, acceptance, scout);
  if (gateRefusal !== null) {
    return refused(gateRefusal);
  }
  const worker = resolveRunWorker(input);
  if (!worker.ok) {
    return refused(worker.error);
  }
  const plan = planRun({ input, scout, acceptance, extras });
  const instruction = composeRunInstruction(plan);
  const request = assembleRunRequest(plan, worker, instruction);
  return { ok: true, request, truncations: instruction.truncations, persona: input.persona?.id ?? null };
}

/** The persona's record says its hand-over gate is structural. */
export function structuralGate(input: ComposeRunInput): boolean {
  return input.persona?.run?.gate === 'structural';
}

function refused(error: string): ComposeRunResult {
  return { ok: false, error };
}
