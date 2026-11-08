/**
 * The fleet's session handover (T-0049, ADR-0075 later change): the
 * pure rules that decide how a run's context reaches its worker — a
 * fresh instruction, the previous run's provider session resumed, or
 * the same natively compacted before the first prompt.
 *
 * Pure on purpose: the supervisor (which holds every run record) and
 * the start dialog (which holds the fleet snapshot) run the SAME rules
 * — the dialog can only disable what these rules call illegal, it can
 * never promise a mode the start would silently switch away. Measured
 * basis: the opencode compact endpoint's shape and effect (spike 2),
 * the resume cost curve with its warm-cache window (spike 3) — see the
 * T-0049 Log.
 *
 * No Node imports: the renderer bundles this module (COMPACT_CAPABILITY
 * and the types); `providers.ts` re-exports the capability table so the
 * main side reads one table too.
 */
import type { FleetHandoverConfig, HandoverMode, RunState, WorkerProviderId } from './protocol';

/**
 * Which providers can compact a session natively (T-0049):
 * - opencode: `POST /api/session/{id}/compact` — measured (spike 2):
 *   200, a `compaction` message, the context halved, ~0.75k tokens.
 * - kimi: `/compact` as an ACP prompt (E10-8) — the wire log shows a
 *   `full_compaction.begin` (source `manual`) for it.
 * - claude-code: `'none'` for now — spike 1 proved `/compact` routes
 *   natively as a stream-json user message, but its OAuth was expired,
 *   so no effect was observed. One-line flip once verified.
 */
export const COMPACT_CAPABILITY: Readonly<Record<WorkerProviderId, 'native' | 'none'>> = {
  opencode: 'native',
  'claude-code': 'none',
  kimi: 'native',
};

/** The run a handover could resume — the newest terminal record of the
 *  same ticket, mapped by the caller (supervisor or board snapshot). */
export interface HandoverCandidate {
  /** The phase the candidate's ticket sat in when it started. */
  readonly phase: string;
  readonly provider: string;
  readonly model: string | null;
  /** Terminal states are candidates — the retry case IS a failed run; `detached` is not (its worker may still live). */
  readonly state: RunState;
  readonly sessionRef: string | null;
  /** The candidate's last assistant turn's input side; null = unknown (every pre-T-0048 record). */
  readonly lastTurnContext: number | null;
  readonly endedAt: string | null;
}

export interface HandoverInput {
  /** What was asked: an explicit mode from the dialog, `'auto'` from the dispatcher. */
  readonly requested: HandoverMode | 'auto';
  /** The phase the new run works — `review` always resolves fresh (independence). */
  readonly phase: string;
  /** The newest terminal record of THIS ticket; null when there is none. */
  readonly candidate: HandoverCandidate | null;
  readonly provider: string;
  readonly model: string | null;
  /** The worktree was recreated or moved aside (T-0047 flag) — prior session context is stale. */
  readonly sessionInvalidated: boolean;
  /** A non-terminal run in this supervisor holds the candidate's session (double-resume hazard). */
  readonly sessionInUse: boolean;
  readonly capability: 'native' | 'none';
  readonly config: FleetHandoverConfig;
  readonly nowMs: number;
}

export interface HandoverDecision {
  readonly mode: HandoverMode;
  /** The session to resume; null on fresh. */
  readonly resumeRef: string | null;
  /** Compact the resumed session before the first prompt (adapter-level flag). */
  readonly compactFirst: boolean;
  /** One line — the stream note and the runner log carry it. */
  readonly why: string;
}

/** The terminal states that may carry a resumable session. */
export const HANDOVER_CANDIDATE_STATES: readonly RunState[] = ['done', 'stopped', 'failed'];

/**
 * The compact threshold that applies to one provider/model pair
 * (T-0049): `<provider>/<model>` beats `<provider>` beats the base —
 * the most-specific override wins, an unknown key never matches.
 */
export function compactThreshold(config: FleetHandoverConfig, provider: string, model: string | null): number {
  return mostSpecific(config.compactAboveTokens, config.compactAboveTokensOverrides, provider, model);
}

/** The mid-run context cap for one provider/model pair (req-80) — the same precedence; 0 = none. */
export function contextCap(config: FleetHandoverConfig, provider: string, model: string | null): number {
  return mostSpecific(config.contextCapTokens, config.contextCapTokensOverrides, provider, model);
}

function mostSpecific(
  base: number,
  overrides: Readonly<Record<string, number>> | undefined,
  provider: string,
  model: string | null,
): number {
  if (overrides !== undefined) {
    if (model !== null) {
      const both = overrides[`${provider}/${model}`];
      if (typeof both === 'number' && Number.isFinite(both) && both >= 0) {
        return both;
      }
    }
    const byProvider = overrides[provider];
    if (typeof byProvider === 'number' && Number.isFinite(byProvider) && byProvider >= 0) {
      return byProvider;
    }
  }
  return base;
}

/**
 * Resolves the handover mode. Rules (auto path; explicit requests are
 * honoured when structurally legal, never silently switched to a
 * different resume mode):
 *
 * - `review` → fresh, always — a fresh worker keeps the review independent.
 * - no candidate / no session / other provider or model / candidate
 *   phase ≠ run phase (build after plan) / invalidated or in-use
 *   session → fresh.
 * - warm pause (within `resumePauseTtlMin`) → resume — the transcript
 *   re-pays as cache reads (spike 3), whatever its size.
 * - known context below `compactAboveTokens` → resume — the re-pay is
 *   bounded, the fidelity loss is not.
 * - context at or above the threshold and a cold pause →
 *   `resume-compact` when the provider compacts natively, else fresh.
 * - unknown context (a pre-T-0048 record) and a cold pause → fresh —
 *   never auto-compact a transcript nobody measured.
 */
export function resolveHandover(input: HandoverInput): HandoverDecision {
  const verdict = structuralVerdict(input);
  if (verdict.kind === 'refused') {
    return fresh(verdict.why);
  }
  // From here a resume is structurally legal; an explicit ask is honoured.
  if (input.requested === 'resume') {
    return resume(verdict.sessionRef, 'explicit resume of the last session');
  }
  if (input.requested === 'resume-compact') {
    return explicitResumeCompact(input, verdict.sessionRef);
  }
  return autoHandover(input, verdict);
}

/** A candidate whose session may be resumed — every structural rule passed. */
interface ResumableSession {
  readonly kind: 'legal';
  readonly candidate: HandoverCandidate;
  readonly sessionRef: string;
}

/** The structural rules' outcome: a fresh start with its reason, or the resumable session. */
type StructuralVerdict = { readonly kind: 'refused'; readonly why: string } | ResumableSession;

function fresh(why: string): HandoverDecision {
  return { mode: 'fresh', resumeRef: null, compactFirst: false, why };
}

function resume(sessionRef: string, why: string): HandoverDecision {
  return { mode: 'resume', resumeRef: sessionRef, compactFirst: false, why };
}

function resumeCompact(sessionRef: string, why: string): HandoverDecision {
  return { mode: 'resume-compact', resumeRef: sessionRef, compactFirst: true, why };
}

function refused(why: string): StructuralVerdict {
  return { kind: 'refused', why };
}

/** The rules that hold on every path, explicit or auto: review, an explicit fresh, no candidate. */
function structuralVerdict(input: HandoverInput): StructuralVerdict {
  if (input.phase === 'review') {
    return refused('the review phase always starts fresh — an independent worker judges the step');
  }
  if (input.requested === 'fresh') {
    return refused('explicit fresh start');
  }
  if (input.candidate === null) {
    return refused('no earlier run of this ticket to resume');
  }
  return candidateVerdict(input, input.candidate);
}

/** Whether the candidate's session fits this run: settled, reported, same worker and phase, not stale or held. */
function candidateVerdict(input: HandoverInput, candidate: HandoverCandidate): StructuralVerdict {
  if (!HANDOVER_CANDIDATE_STATES.includes(candidate.state)) {
    return refused(`the last run is ${candidate.state} — only a settled run leaves a resumable session`);
  }
  if (candidate.sessionRef === null) {
    return refused('the last run reported no session');
  }
  if (candidate.provider !== input.provider || candidate.model !== input.model) {
    return refused(
      `the last session ran ${workerLabel(candidate.provider, candidate.model)}` +
        ` — this run is ${workerLabel(input.provider, input.model)}`,
    );
  }
  if (candidate.phase !== input.phase) {
    return refused(`the last session worked the ${candidate.phase} phase — this run starts ${input.phase} fresh`);
  }
  if (input.sessionInvalidated) {
    return refused('the worktree was recreated or moved aside — the session\'s file state is stale');
  }
  if (input.sessionInUse) {
    return refused('another run holds that session — resuming it twice is refused');
  }
  return { kind: 'legal', candidate, sessionRef: candidate.sessionRef };
}

/** `<provider>` or `<provider>/<model>`. */
function workerLabel(provider: string, model: string | null): string {
  return `${provider}${model !== null ? `/${model}` : ''}`;
}

function explicitResumeCompact(input: HandoverInput, sessionRef: string): HandoverDecision {
  if (input.capability !== 'native') {
    return fresh(`the ${input.provider} worker cannot compact natively`);
  }
  return resumeCompact(sessionRef, 'explicit resume with a native compact first');
}

/** The auto path — the measured rules, split by whether the pause is still warm. */
function autoHandover(input: HandoverInput, session: ResumableSession): HandoverDecision {
  const pauseMs = pauseSince(session.candidate.endedAt, input.nowMs);
  const warmMs = input.config.resumePauseTtlMin * 60_000;
  if (pauseMs < warmMs) {
    return warmHandover(input, session, pauseMs);
  }
  return coldHandover(input, session);
}

/** Milliseconds since the candidate ended; an unknown or unparsable end counts as an endless (cold) pause. */
function pauseSince(endedAt: string | null, nowMs: number): number {
  return endedAt !== null && Number.isFinite(Date.parse(endedAt))
    ? nowMs - Date.parse(endedAt)
    : Number.POSITIVE_INFINITY;
}

function warmHandover(input: HandoverInput, session: ResumableSession, pauseMs: number): HandoverDecision {
  const context = session.candidate.lastTurnContext;
  const cap = contextCap(input.config, input.provider, input.model);
  if (cap > 0 && context !== null && context >= cap) {
    return overCapHandover(input, session.sessionRef, context, cap);
  }
  const minutes = Math.max(0, Math.round(pauseMs / 60_000));
  return resume(
    session.sessionRef,
    context !== null
      ? `pause ${minutes} min is within the cache TTL — the transcript re-pays cached (ctx ${context})`
      : `pause ${minutes} min is within the cache TTL — the transcript re-pays cached`,
  );
}

/**
 * A warm pause used to resume at any size (a retry came back at 148 k
 * against a 120 k cap and grew to 184 k): an over-cap transcript is
 * compacted when the worker can, else the step starts fresh.
 */
function overCapHandover(input: HandoverInput, sessionRef: string, context: number, cap: number): HandoverDecision {
  if (input.capability === 'native') {
    return resumeCompact(
      sessionRef,
      `warm pause, but the ${context}-token context is over the ${cap} cap — resumed and natively compacted first`,
    );
  }
  return fresh(`warm pause, but the ${context}-token context is over the ${cap} cap and the worker cannot compact — fresh is cheaper`);
}

function coldHandover(input: HandoverInput, session: ResumableSession): HandoverDecision {
  const context = session.candidate.lastTurnContext;
  if (context === null) {
    return fresh('cold pause and the last context is unknown — never auto-compact an unmeasured transcript');
  }
  const threshold = compactThreshold(input.config, input.provider, input.model);
  if (context < threshold) {
    return resume(
      session.sessionRef,
      `cold pause, but the context (${context}) is below the compact threshold — resumed as it is`,
    );
  }
  // Both comparisons stay explicit: a NaN threshold fails both and falls through to fresh.
  if (context >= threshold && input.capability === 'native') {
    return resumeCompact(
      session.sessionRef,
      `cold pause with a ${context}-token context — resumed and natively compacted first`,
    );
  }
  return fresh(`cold pause with a ${context}-token context and no native compact — fresh is cheaper`);
}
