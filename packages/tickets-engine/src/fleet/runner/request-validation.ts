import { ticketPathParts } from '../../core/ticket/ticket-files';
import type { RunRequest } from '../protocol';

/** The ticket's identity: id, and a path that matches id and phase. */
function ticketFailures(request: RunRequest): string[] {
  const failures: string[] = [];
  if (!/^T-\d{4,}$/.test(request.ticketId)) {
    failures.push(`"${request.ticketId}" is not a ticket id`);
  }
  // Prefix-aware (T-0041): `tickets/30-plan/…` and `tickets/plan/…` both match the phase `plan`.
  const parts = ticketPathParts(request.ticketRelPath);
  if (parts === null || parts.phase !== request.phase || parts.stem !== request.ticketId) {
    failures.push(`the ticket path does not match id and phase (${request.ticketRelPath})`);
  }
  if (request.instruction.trim() === '') {
    failures.push('the instruction is empty');
  }
  return failures;
}

/** Who asks (D-41), the deterministic branch, the worktree the home rule computed. */
function startFailures(request: RunRequest): string[] {
  const failures: string[] = [];
  if ((request.origin ?? '').trim() === '') {
    failures.push('the start names no origin - every start says who asks for it');
  }
  if (request.branch !== `t/${request.ticketId}`) {
    failures.push(`the branch is not the deterministic t/${request.ticketId}`);
  }
  if (request.worktreePath.trim() === '') {
    failures.push('the worktree path is empty (a pre-T-0044 sender derived it itself)');
  }
  return failures;
}

/**
 * The rules the runner enforces itself (ADR-0076: the validator runs where
 * the data is). Every failure is one sentence; an empty list starts.
 */
export function validateRequest(request: RunRequest): readonly string[] {
  const failures = [...ticketFailures(request), ...startFailures(request)];
  // req-176: the store is the one backend — a run writes its ticket only through its claim.
  if (request.dk === undefined) {
    failures.push('the request names no dricket store (dk) - the runner writes tickets only through a store claim');
  }
  // A 'commands' gate demands what it runs ('structural' writes its own check, 'none' never gates).
  if (request.acceptance.length === 0 && request.gate === 'commands') {
    failures.push('the request carries no gate commands: the machine gate runs only the "- [ ] `command`" lines of the ticket, and there are none');
  }
  return failures;
}
