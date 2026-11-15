import type { RunInfo, RunRequest, SessionSpec } from '../protocol';
import { isOneOnOne } from '../protocol-session';
import { isTerminal } from '../runner/run-state';
import type { HeldSessionKind } from './held-session-kind';

type OneOnOneSpec = Extract<SessionSpec, { kind: '1:1' }>;

/**
 * The 1:1 (req-168, ADR-0093, R1/R12): the persona's conversation with the
 * owner in the tickets repository, read-only — one live 1:1 per persona,
 * its conversation in the chat session file.
 */
export class OneOnOneKind implements HeldSessionKind<OneOnOneSpec> {
  refusal(request: RunRequest, spec: OneOnOneSpec, live: readonly RunInfo[]): string | null {
    if (spec.workingDirectory.trim() === '') {
      return 'a 1:1 names its working directory';
    }
    if (request.instruction.trim() === '') {
      return 'the 1:1 brief is empty';
    }
    const other = live.find((r) => isOneOnOne(r) && r.persona === spec.persona && !isTerminal(r.state));
    return other === undefined ? null : `${spec.persona} already has a live 1:1 (${other.id})`;
  }

  infoOf(base: RunInfo, spec: OneOnOneSpec): RunInfo {
    return { ...base, kind: '1:1', workingDirectory: spec.workingDirectory, chatFile: spec.chatFile, column: null, phase: null, quietStart: true, held: true };
  }

  openingLine(id: string, spec: OneOnOneSpec): string {
    return `session ${id} — 1:1 with ${spec.persona} in ${spec.workingDirectory} (read-only, no ticket, no worktree)`;
  }

  note(spec: OneOnOneSpec): string {
    return `1:1 with ${spec.persona} — the worker waits for your first line; read-only, no ticket, released after idle`;
  }

  label(spec: OneOnOneSpec): string {
    return `1:1 with ${spec.persona}`;
  }
}
