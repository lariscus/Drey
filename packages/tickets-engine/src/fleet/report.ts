/**
 * The fleet's token report (T-0048): groups run telemetry by ticket,
 * phase and model, sorted by total — the numbers the owner decides
 * handover and model-tiering questions with (T-0049 reads them from
 * `GET /report`, not from a session's memory).
 *
 * Pure over `ReportRun`; absent counters count 0 into a group's sums,
 * and a pre-T-0048 record (no `usage`) falls back to its cumulative
 * `tokensIn`/`tokensOut`. E3 (ADR-0088) adds the per-persona cost
 * grouping (`personaCostReport`) next to the ticket/phase/model one.
 */
import type { RunUsage } from './protocol';

export interface ReportRun {
  readonly ticketId: string;
  readonly phase: string;
  readonly model: string | null;
  readonly provider: string;
  /**
   * The persona that dispatched the run (ADR-0088 E3); null/undefined on
   * runs from before personas and on ring-dispatched runs.
   */
  readonly persona?: string | null;
  /** Per-run usage summed over turns; null on pre-T-0048 records. */
  readonly usage: RunUsage | null;
  /** Pre-T-0048 fallback counters (cumulative, as reported then). */
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly tokensBeforeFirstWrite: number | null;
  /** The run's cost in USD, when the provider reported one. */
  readonly costUsd?: number | null;
}

export interface ReportGroup {
  readonly ticket: string;
  readonly phase: string;
  readonly model: string | null;
  readonly runs: number;
  /** input + cacheRead + cacheCreation + output, absent counted 0. */
  readonly total: number;
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
  readonly output: number;
  /** Input-side tokens before the first write, summed; null when no run reported one. */
  readonly beforeFirstWrite: number | null;
  /** beforeFirstWrite's share of the group's input side (input+cacheRead+cacheCreation); null when not computable. */
  readonly beforeFirstWriteShare: number | null;
}

/** One run's total: the telemetry when it exists, the old counters otherwise. */
function runTotal(run: ReportRun): number {
  if (run.usage !== null) {
    return (run.usage.input ?? 0) + (run.usage.cacheRead ?? 0) + (run.usage.cacheCreation ?? 0) + (run.usage.output ?? 0);
  }
  return run.tokensIn + run.tokensOut;
}

/** The counters both reports sum per group. */
interface UsageCounters {
  runs: number;
  total: number;
  input: number;
  cacheRead: number;
  cacheCreation: number;
  output: number;
}

/** Adds one run to a group's counters; an absent usage counter counts 0. */
function addUsage(group: UsageCounters, run: ReportRun): void {
  group.runs++;
  group.total += runTotal(run);
  group.input += run.usage?.input ?? 0;
  group.cacheRead += run.usage?.cacheRead ?? 0;
  group.cacheCreation += run.usage?.cacheCreation ?? 0;
  group.output += run.usage?.output ?? 0;
}

interface TokenGroup extends UsageCounters {
  ticket: string;
  phase: string;
  model: string | null;
  inputSide: number;
  beforeFirstWrite: number | null;
}

function tokenGroups(runs: readonly ReportRun[]): TokenGroup[] {
  const byKey = new Map<string, TokenGroup>();
  for (const run of runs) {
    const key = `${run.ticketId}\u0000${run.phase}\u0000${run.model ?? ''}`;
    const group = byKey.get(key) ?? { ticket: run.ticketId, phase: run.phase, model: run.model, runs: 0, total: 0, input: 0, cacheRead: 0, cacheCreation: 0, output: 0, inputSide: 0, beforeFirstWrite: null };
    addUsage(group, run);
    group.inputSide += (run.usage?.input ?? 0) + (run.usage?.cacheRead ?? 0) + (run.usage?.cacheCreation ?? 0);
    if (run.tokensBeforeFirstWrite !== null) {
      group.beforeFirstWrite = (group.beforeFirstWrite ?? 0) + run.tokensBeforeFirstWrite;
    }
    byKey.set(key, group);
  }
  return [...byKey.values()];
}

function reportGroupOf(g: TokenGroup): ReportGroup {
  return {
    ticket: g.ticket,
    phase: g.phase,
    model: g.model,
    runs: g.runs,
    total: g.total,
    input: g.input,
    cacheRead: g.cacheRead,
    cacheCreation: g.cacheCreation,
    output: g.output,
    beforeFirstWrite: g.beforeFirstWrite,
    beforeFirstWriteShare: g.beforeFirstWrite !== null && g.inputSide > 0 ? g.beforeFirstWrite / g.inputSide : null,
  };
}

export function tokenReport(runs: readonly ReportRun[]): readonly ReportGroup[] {
  return tokenGroups(runs)
    .map(reportGroupOf)
    .sort(
      (a, b) =>
        b.total - a.total ||
        a.ticket.localeCompare(b.ticket) ||
        a.phase.localeCompare(b.phase) ||
        (a.model ?? '').localeCompare(b.model ?? ''),
    );
}

/** The bucket persona-less runs (and pre-personas records) aggregate under. */
export const UNASSIGNED_PERSONA = 'unassigned';

/** One persona's share of the fleet's token spend (E3, ADR-0088). */
export interface PersonaCost {
  /** The persona id; runs without one aggregate under `UNASSIGNED_PERSONA`. */
  readonly persona: string;
  readonly runs: number;
  /** input + cacheRead + cacheCreation + output, absent counted 0. */
  readonly total: number;
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
  readonly output: number;
  /** Sum of the runs' costs; null when no run of the group reported one. */
  readonly costUsd: number | null;
}

/**
 * The cost attribution per persona (E3, ADR-0088): the same counters as
 * `tokenReport`, aggregated by the persona that dispatched the run —
 * tokens in/out/cache, run count and cost. Runs with no persona (the
 * legacy ring's dispatches, pre-personas records) land in the
 * `UNASSIGNED_PERSONA` bucket, so the grouping is total over its input:
 * every run contributes to exactly one bucket. A pre-T-0048 record
 * (no `usage`) falls back to its cumulative `tokensIn`/`tokensOut`,
 * and `costUsd` stays null until a run of the group reports one.
 */
export function personaCostReport(runs: readonly ReportRun[]): readonly PersonaCost[] {
  const byPersona = new Map<string, UsageCounters & { persona: string; costUsd: number | null }>();
  for (const run of runs) {
    const key = run.persona ?? UNASSIGNED_PERSONA;
    const group = byPersona.get(key) ?? { persona: key, runs: 0, total: 0, input: 0, cacheRead: 0, cacheCreation: 0, output: 0, costUsd: null };
    addUsage(group, run);
    if (run.costUsd !== null && run.costUsd !== undefined) {
      group.costUsd = (group.costUsd ?? 0) + run.costUsd;
    }
    byPersona.set(key, group);
  }
  return [...byPersona.values()].sort((a, b) => b.total - a.total || a.persona.localeCompare(b.persona));
}
