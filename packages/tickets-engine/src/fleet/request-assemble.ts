import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import type { PipelinePhase, RepoRef } from '../contracts/tickets';
import type { ComposedInstruction } from './instruction-parts';
import type { RunRequest } from './protocol';
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
type MoveParts = Pick<RunRequest, 'nextPhase' | 'nextPhaseDir' | 'pushRemote' | 'claimIdentity'>;
type OptionalParts = Pick<RunRequest, 'limits' | 'recordWorker' | 'column' | 'handover' | 'interactive' | 'dk' | 'parkFor' | 'profile'>;

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
    permissionMode: input.permissionMode,
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
  };
}

/** The keys a request carries only when they are set. */
function optionalParts(plan: RunPlan): OptionalParts {
  const { input, moves } = plan;
  const limits = limitsOf(input.workingPhase);
  return {
    ...(limits !== null ? { limits } : {}),
    ...(input.workerChoice !== null ? { recordWorker: input.workerChoice } : {}),
    ...(input.dispatchedBy !== undefined ? { column: input.dispatchedBy } : {}),
    ...(input.handover !== undefined ? { handover: input.handover } : {}),
    ...(input.interactive !== undefined ? { interactive: input.interactive } : {}),
    ...(input.dk !== undefined ? { dk: input.dk } : {}),
    ...(moves && input.parkFor ? { parkFor: input.parkFor } : {}),
    ...profileParts(input.repo),
  };
}

/** req-177: the repository's slot profile, when `repos.md` sets one (absent reads as `private`). */
function profileParts(repo: RepoRef | null): Pick<RunRequest, 'profile'> {
  return repo !== null && repo.profile !== undefined ? { profile: repo.profile } : {};
}

/** The column's own ceilings as the request carries them, or null when it sets none. */
function limitsOf(phase: PipelinePhase | null): { maxTurns?: number; maxWorkMs?: number } | null {
  if (phase === null || (phase.maxTurns === null && phase.maxWorkMin === null)) {
    return null;
  }
  return {
    ...(phase.maxTurns !== null ? { maxTurns: phase.maxTurns } : {}),
    ...(phase.maxWorkMin !== null ? { maxWorkMs: phase.maxWorkMin * 60_000 } : {}),
  };
}

/** The fleet's actor identity for stamps (`agent@<host>`). */
export function agentIdentity(): string {
  return `agent@${hostname().toLowerCase()}`;
}
