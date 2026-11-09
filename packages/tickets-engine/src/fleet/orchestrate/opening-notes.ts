import type { HandoverDecision } from '../handover';
import type { ReviewCheckoutRecord, RunInfo, RunRequest } from '../protocol';
import type { NormalizedEvent } from '../harness/contract';
import type { LinkReport, PreparedWorktree } from '../worktrees';
import type { SlotBinding } from './slot-binder';

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
  /** req-177: the slot (account) the run starts on; absent without slots. */
  readonly slot?: SlotBinding | null;
  /** req-183: the review run's read-only checkout; absent on every other run. */
  readonly review?: ReviewCheckoutRecord | null;
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
    opening.review !== undefined && opening.review !== null ? `review checkout ${opening.review.checkout} at ${opening.review.commit.slice(0, 10)} — detached, read-only` : null,
    decision !== null ? `handover: ${decision.mode} — ${decision.why}` : null,
    ...slotNotes(opening.slot ?? null),
  ];
  return lines.filter((text): text is string => text !== null).map((text) => ({ ts: stamp, kind: 'note', text }));
}

/** The slot (req-177), the pool's grant (req-170) and the routing's line (req-178). */
function slotNotes(slot: SlotBinding | null): readonly string[] {
  if (slot === null) {
    return [];
  }
  const grant = slot.grant;
  return [`slot: ${slot.label}`, ...(grant !== undefined ? [`pool: ${grant.reason}`] : []), ...(grant?.route !== undefined ? [grant.route.line] : [])];
}

/** The slot (req-177) and the pool's grant (req-170) a run's record carries; nothing without a binding. */
function slotFields(slot: SlotBinding | null): Pick<RunInfo, 'slot' | 'grant'> {
  if (slot === null) {
    return {};
  }
  return { slot: { id: slot.id, label: slot.label }, ...(slot.grant !== undefined ? { grant: slot.grant } : {}) };
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
    ...slotFields(opening.slot ?? null),
    ...(opening.review !== undefined && opening.review !== null ? { review: opening.review } : {}),
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
