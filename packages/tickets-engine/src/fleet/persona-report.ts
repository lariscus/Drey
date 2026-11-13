/**
 * The report grouped by persona and by chain position (req-274, the persona
 * board concept §10), next to the ticket/phase/model token report.
 *
 * - **Per persona:** the token and cost counters of `personaCostReport`,
 *   the red gates of its runs, and the time it held tickets — summed from
 *   the ledger's `hold` lines (`core/hold-spans.ts`). A persona that held
 *   tickets but ran nothing (`you`, a persona whose ticket waited for a
 *   slot) has a row of its own with zero runs.
 * - **Per chain position:** the runs that worked it, their cost and busy
 *   time (the run telemetry's working time; the run record carries its
 *   position since req-274), the time tickets were held there, and the
 *   waiting time — held minus busy, when both are known.
 *
 * Pure over `ReportRun` and the hold spans; absent stays null, never 0.
 */
import { heldMsByPersona, heldMsByPosition, type HoldSpan } from '../core/hold-spans';
import { personaCostReport, UNASSIGNED_PERSONA, type PersonaCost, type ReportRun } from './report';

/** One persona's row: its cost, its red gates and the time it held tickets. */
export interface PersonaReport extends PersonaCost {
  /** Runs of the persona whose machine gate came back red. */
  readonly redGates: number;
  /** The time the persona held tickets, in milliseconds; null when the ledger records no hold of it. */
  readonly heldMs: number | null;
}

/** One chain position's row (position 1 of every chain together, position 2 …). */
export interface PositionReport {
  readonly position: number;
  readonly runs: number;
  /** Sum of the runs' costs; null when no run of the position reported one. */
  readonly costUsd: number | null;
  /** The runs' working time, summed; null when no run of the position reported one. */
  readonly busyMs: number | null;
  /** The time tickets were held at the position; null when the ledger records no hold there. */
  readonly heldMs: number | null;
  /** Held minus busy (never below 0); null unless both are known. */
  readonly waitingMs: number | null;
}

const addKnown = (sum: number | null, value: number | null | undefined): number | null => (value === null || value === undefined ? sum : (sum ?? 0) + value);

function emptyPersona(persona: string): PersonaCost {
  return { persona, runs: 0, total: 0, input: 0, cacheRead: 0, cacheCreation: 0, output: 0, costUsd: null };
}

/** The persona rows: every persona with a run or a hold, sorted by tokens, then held time, then id. */
export function personaReport(runs: readonly ReportRun[], spans: readonly HoldSpan[]): readonly PersonaReport[] {
  const held = heldMsByPersona(spans);
  const red = new Map<string, number>();
  for (const run of runs.filter((r) => r.gate === 'red')) {
    const key = run.persona ?? UNASSIGNED_PERSONA;
    red.set(key, (red.get(key) ?? 0) + 1);
  }
  const costs = personaCostReport(runs);
  const named = new Set(costs.map((row) => row.persona));
  const rows = [...costs, ...[...held.keys()].filter((persona) => !named.has(persona)).map(emptyPersona)];
  return rows
    .map((row) => ({ ...row, redGates: red.get(row.persona) ?? 0, heldMs: held.get(row.persona) ?? null }))
    .sort((a, b) => b.total - a.total || (b.heldMs ?? 0) - (a.heldMs ?? 0) || a.persona.localeCompare(b.persona));
}

interface PositionSums {
  runs: number;
  costUsd: number | null;
  busyMs: number | null;
}

/** The position rows: every position a chain run worked or a ticket was held at, in position order. */
export function positionReport(runs: readonly ReportRun[], spans: readonly HoldSpan[]): readonly PositionReport[] {
  const held = heldMsByPosition(spans);
  const sums = new Map<number, PositionSums>();
  for (const run of runs) {
    if (run.position === null || run.position === undefined) {
      continue;
    }
    const sum = sums.get(run.position) ?? { runs: 0, costUsd: null, busyMs: null };
    sum.runs++;
    sum.costUsd = addKnown(sum.costUsd, run.costUsd);
    sum.busyMs = addKnown(sum.busyMs, run.busyMs);
    sums.set(run.position, sum);
  }
  const positions = [...new Set([...sums.keys(), ...held.keys()])].sort((a, b) => a - b);
  return positions.map((position) => {
    const sum = sums.get(position) ?? { runs: 0, costUsd: null, busyMs: null };
    const heldMs = held.get(position) ?? null;
    const waitingMs = heldMs !== null && sum.busyMs !== null ? Math.max(0, heldMs - sum.busyMs) : null;
    return { position, runs: sum.runs, costUsd: sum.costUsd, busyMs: sum.busyMs, heldMs, waitingMs };
  });
}
