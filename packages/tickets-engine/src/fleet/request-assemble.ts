import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import type { PipelinePhase, RepoRef } from '../contracts/tickets';
import type { ComposedInstruction } from './instruction-parts';
import type { ClosingSignal } from '../core/closing-signals';
import { HUMAN_PERSONA_ID } from '../core/persona';
import type { PersonaRunSettings } from '../core/persona-settings';
import { DEFAULT_CLOSING_SPEC, type RunRequest } from './protocol';
import type { RunPlan } from './request-plan';
import type { RunWorkerPin } from './request-worker';

type WhereParts = Pick<
  RunRequest,
  | 'origin'
  | 'ticketId'
  | 'form'
  | 'ticketsVaultPath'
  | 'ticketRelPath'
  | 'phase'
  | 'repoPath'
  | 'worktreePath'
  | 'branch'
  | 'baseRef'
  | 'links'
  | 'extraRepos'
>;
type WorkParts = Pick<
  RunRequest,
  'provider' | 'model' | 'permissionMode' | 'instruction' | 'continuationInstruction' | 'briefDigest' | 'acceptance' | 'gate' | 'git'
>;
type MoveParts = Pick<RunRequest, 'nextPhase' | 'nextPhaseDir' | 'pushRemote' | 'claimIdentity' | 'cursor'>;
type OptionalParts = Pick<RunRequest, 'limits' | 'recordWorker' | 'column' | 'handover' | 'interactive' | 'dk' | 'parkFor' | 'leaving' | 'machine' | 'reviewCheckout' | 'closing'>;

/** The wire request, its keys in the order the runner's log and record have always shown them. */
export function assembleRunRequest(plan: RunPlan, worker: RunWorkerPin, instruction: ComposedInstruction): RunRequest {
  return { ...whereParts(plan), ...workParts(plan, worker, instruction), ...moveParts(plan), ...optionalParts(plan) };
}

/** Which ticket, and where the worker runs it. */
function whereParts(plan: RunPlan): WhereParts {
  const { input, scout } = plan;
  const repo = input.repo;
  return {
    origin: input.origin,
    ticketId: input.card.id,
    ...(scout ? { form: 'scout' as const } : {}),
    ticketsVaultPath: input.vaultPath,
    ticketRelPath: input.card.path,
    phase: input.card.phase,
    repoPath: plan.readGround,
    worktreePath: plan.worktreePath,
    branch: plan.branch,
    baseRef: scout ? null : repo!.branch,
    ...(repo !== null && !scout && repo.link !== undefined && repo.link.length > 0 ? { links: repo.link } : {}),
    ...(plan.extras.worktrees.length > 0 ? { extraRepos: plan.extras.worktrees } : {}),
  };
}

/** Who works, on what brief, and the gate that judges it. */
function workParts(plan: RunPlan, worker: RunWorkerPin, instruction: ComposedInstruction): WorkParts {
  const { input, scout, acceptance } = plan;
  const git = input.gitPath.trim();
  return {
    provider: worker.provider,
    model: worker.model,
    // req-183: a review's session runs read-only, whatever the board's setting says.
    permissionMode: plan.reviewCheckout !== null ? 'read-only' : input.permissionMode,
    instruction: instruction.text,
    continuationInstruction: instruction.continuation,
    briefDigest: createHash('sha256').update(instruction.stable).digest('hex'),
    acceptance,
    gate: scout ? 'none' : acceptance.length > 0 ? 'commands' : 'structural',
    git: git === '' ? 'git' : git,
  };
}

/** Where a green gate takes the ticket, and who claims it there. */
function moveParts(plan: RunPlan): MoveParts {
  const { input, moves } = plan;
  return {
    nextPhase: moves ? input.nextPhaseId : null,
    nextPhaseDir: !moves || input.nextPhaseId === null ? null : input.nextPhaseDir,
    pushRemote: input.pushRemote,
    claimIdentity: moves && input.nextPhaseClaims && input.nextPhaseId !== null ? agentIdentity() : null,
    ...(moves && input.cursor !== undefined ? { cursor: input.cursor } : {}),
  };
}

/** The keys a request carries only when they are set. */
function optionalParts(plan: RunPlan): OptionalParts {
  const { input, moves } = plan;
  const limits = limitsOf(input.workingPhase, input.persona?.run ?? null);
  return {
    ...(limits !== null ? { limits } : {}),
    ...(input.workerChoice !== null ? { recordWorker: input.workerChoice } : {}),
    ...(input.dispatchedBy !== undefined ? { column: input.dispatchedBy } : {}),
    ...(input.handover !== undefined ? { handover: input.handover } : {}),
    ...(input.interactive !== undefined ? { interactive: input.interactive } : {}),
    ...(input.dk !== undefined ? { dk: input.dk } : {}),
    ...(moves && input.parkFor ? { parkFor: input.parkFor } : {}),
    ...leavingParts(plan),
    ...(plan.reviewCheckout !== null ? { reviewCheckout: plan.reviewCheckout } : {}),
    ...closingParts(input.closingSignals, input.gateFailure),
  };
}

/**
 * req-267: `sync-main` rides a ship run with a repository whose persona lists it; the commit is the
 * sign-off's machine run (`commitStep`), never a run's end.
 */
function leavingParts(plan: RunPlan): Pick<RunRequest, 'leaving' | 'machine'> {
  const { input, scout } = plan;
  if (input.commitStep === true) {
    return input.repo === null ? {} : { machine: { action: 'commit', persona: HUMAN_PERSONA_ID, policy: input.repo.policy } };
  }
  const syncs = input.persona?.run?.leaving.includes('sync-main') === true;
  return syncs && !scout && input.repo !== null && input.interactive === undefined ? { leaving: ['sync-main'] } : {};
}

/** req-169: the closing round's signals and the retry flag — carried only when they differ from the default (all five, no retry). */
function closingParts(signals: readonly ClosingSignal[] | undefined, gateFailure: string | null): Pick<RunRequest, 'closing'> {
  if (signals === undefined && gateFailure === null) {
    return {};
  }
  return { closing: { signals: signals ?? DEFAULT_CLOSING_SPEC.signals, retry: gateFailure !== null } };
}

const firstSet = (own: number | null | undefined, column: number | null | undefined): number | null => own ?? column ?? null;

/** The run ceilings as the request carries them — the persona's where its record sets one (req-258), else the column's; null when neither does. */
function limitsOf(phase: PipelinePhase | null, persona: Pick<PersonaRunSettings, 'maxTurns' | 'maxWorkMin'> | null): { maxTurns?: number; maxWorkMs?: number } | null {
  const maxTurns = firstSet(persona?.maxTurns, phase?.maxTurns);
  const maxWorkMin = firstSet(persona?.maxWorkMin, phase?.maxWorkMin);
  if (maxTurns === null && maxWorkMin === null) {
    return null;
  }
  return {
    ...(maxTurns !== null ? { maxTurns } : {}),
    ...(maxWorkMin !== null ? { maxWorkMs: maxWorkMin * 60_000 } : {}),
  };
}

/** The fleet's actor identity for stamps (`agent@<host>`). */
export function agentIdentity(): string {
  return `agent@${hostname().toLowerCase()}`;
}
