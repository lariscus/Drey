import { acceptanceFinding } from '../core/ticket-files';
import { isAutoPhase } from './chain';
import type { ComposeRunInput } from './request';

/**
 * D-29: every start passes here, so this is where the owner's columns are closed. A manual column is
 * the owner's: nothing is run out of it, whoever asks. Only the owner's own dialog and Accept's commit step work there.
 */
export function ownerColumnRefusal(input: ComposeRunInput): string | null {
  const phaseOfRun = input.workingPhase;
  if (phaseOfRun !== null && !isAutoPhase(phaseOfRun) && input.interactive === undefined && input.commitStep !== true) {
    return `${input.card.id} sits in ${phaseOfRun.title}, the owner's column: the fleet takes nothing from it. Move it into an agent column to run it.`;
  }
  return null;
}

/**
 * A ship run needs a named repo; any NAMED repo needs a local path —
 * a ticket pointing at an unreadable checkout is a refusal, never a
 * guess. Only a scout ticket naming no repo at all falls back to the vault.
 */
export function repoRefusal(input: ComposeRunInput, scout: boolean): string | null {
  const repo = input.repo;
  if (repo === null && !scout) {
    return `${input.card.id} names no repository — set repo: to a _meta/repos.md entry`;
  }
  if (repo !== null && repo.path === null) {
    return `"${repo.name}" has no local path: in _meta/repos.md — the worker needs a checkout`;
  }
  return null;
}

/**
 * A ship run gates on the ticket's acceptance commands; none is a
 * refusal unless the run may gate structurally (the pipeline's first
 * worker column, or a persona whose `gate:` is structural — req-258) or the
 * owner drives it as a dialog.
 */
export function acceptanceRefusal(input: ComposeRunInput, acceptance: readonly string[], scout: boolean): string | null {
  const structural = input.structuralGateAllowed === true || input.persona?.run?.gate === 'structural';
  if (acceptance.length === 0 && !scout && !structural && input.interactive === undefined && input.commitStep !== true) {
    return `${input.card.id} has no runnable acceptance criteria: ${acceptanceFinding(input.ticketText)}`;
  }
  return null;
}
