import type { RunInfo, RunRequest, SessionSpec } from '../protocol';
import type { HeldSessionKind } from './held-session-kind';

type FreeSpec = Extract<SessionSpec, { kind: 'free' }>;

/**
 * The free session (req-173, R12): the owner opened it — from the service
 * window, the Crew tab, or Pia's card — in a directory they named, with the
 * persona's harness and the permission mode the request carries (the
 * vault's, unless the owner chose another). No ticket, no worktree, no
 * gate; held between the owner's lines and released after idle. The
 * directory was checked before the request was built
 * (`session/session-directory-rule.ts`); several free sessions of one
 * persona may stand at once.
 */
export class FreeSessionKind implements HeldSessionKind<FreeSpec> {
  refusal(request: RunRequest, spec: FreeSpec): string | null {
    if (spec.workingDirectory.trim() === '') {
      return 'a free session names its directory';
    }
    return request.instruction.trim() === '' ? 'the free session brief is empty' : null;
  }

  infoOf(base: RunInfo, spec: FreeSpec): RunInfo {
    return { ...base, kind: 'free', workingDirectory: spec.workingDirectory, column: null, phase: null, quietStart: true, held: true };
  }

  openingLine(id: string, spec: FreeSpec, request: RunRequest): string {
    return `session ${id} — free session of ${spec.persona} in ${spec.workingDirectory} (${request.permissionMode}, no ticket, no worktree)`;
  }

  note(spec: FreeSpec, request: RunRequest): string {
    return `free session of ${spec.persona} in ${spec.workingDirectory} — the worker waits for your first line; ${request.permissionMode}, released after idle`;
  }

  label(spec: FreeSpec): string {
    return `free session of ${spec.persona}`;
  }
}
