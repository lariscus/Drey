import type { HandoverDecision } from '../handover';
import type { RunInfo, RunRequest } from '../protocol';
import type { NormalizedEvent } from '../providers';
import type { LinkReport, PreparedWorktree } from '../worktrees';

/** The stream's setup line for the repo's `link:` folders (req-56). */
export function linkNote(report: LinkReport): string {
  const parts = [
    report.linked.length > 0 ? `linked ${report.linked.join(', ')}` : '',
    report.present.length > 0 ? `already there ${report.present.join(', ')}` : '',
    ...report.skipped.map((s) => `left out ${s.path} (${s.reason})`),
  ].filter((part) => part !== '');
  return `worktree links: ${parts.join('; ')}`;
}

/** What a run starts from, for its record and its opening lines. */
export interface RunOpening {
  readonly id: string;
  readonly request: RunRequest;
  readonly prepared: PreparedWorktree | null;
  readonly decision: HandoverDecision | null;
  readonly resumeRef: string | null;
  readonly persona: string | null;
  readonly stamp: string;
}

/** The first lines of a run's stream: what runs where, a moved-aside worktree, the links, the handover. */
export function openingNotes(opening: RunOpening): readonly NormalizedEvent[] {
  const { id, request, prepared, decision, stamp } = opening;
  const lines = [
    prepared === null
      ? `run ${id} for ${request.ticketId} — scout run, read ground ${request.worktreePath} (no worktree, no gate, no move)`
      : `run ${id} for ${request.ticketId} on ${request.branch} — worktree ${prepared.outcome}`,
    prepared?.outcome === 'moved-aside' ? `stale dirty worktree moved aside to ${prepared.movedTo} — kept, not deleted; earlier session context is invalid` : null,
    prepared?.links !== undefined ? linkNote(prepared.links) : null,
    decision !== null ? `handover: ${decision.mode} — ${decision.why}` : null,
  ];
  return lines.filter((text): text is string => text !== null).map((text) => ({ ts: stamp, kind: 'note', text }));
}

/** A new run's record, `starting`, with every counter at zero. */
export function newRunInfo(opening: RunOpening, initial: RunInfo['state']): RunInfo {
  const { id, request, prepared, decision, stamp } = opening;
  return {
    id,
    ticketId: request.ticketId,
    persona: opening.persona, // E3: the persona the dispatcher's ladder resolved (null on ring dispatches)
    ...(request.origin !== undefined ? { origin: request.origin } : {}),
    provider: request.provider,
    state: initial,
    pid: null,
    startedAt: stamp,
    endedAt: null,
    sessionRef: opening.resumeRef,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: null,
    lastActivity: stamp,
    activity: '',
    contextTokens: null,
    column: request.column ?? request.phase,
    steerCount: 0,
    lastSteerRung: null,
    worktreePath: request.worktreePath,
    branch: request.branch,
    ...(prepared !== null ? { worktree: prepared.outcome } : {}),
    gateResult: null,
    model: request.model,
    phase: request.phase,
    ...(request.form === 'scout' ? { form: 'scout' as const } : {}), // E8: the board's lanes and the settle hooks read it
    usage: { input: null, cacheRead: null, cacheCreation: null, output: null },
    lastTurnContext: null,
    turns: 0,
    readCalls: 0,
    tokensBeforeFirstWrite: null,
    handoverMode: decision?.mode ?? 'fresh',
    // The candidate's session, never the init event — a forked id would lose the lineage (T-0049).
    resumedFrom: decision !== null && decision.mode !== 'fresh' ? decision.resumeRef : null,
    gateFailure: null,
  };
}
