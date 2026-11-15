/**
 * The fleet ledger (E7, concept §3.3): `_meta/ledger.jsonl`, one JSON
 * line per fleet event — the real-time hook for Mission Control and
 * the reports, without parsing Markdown. Append-only; the git log
 * stays the history of contents, the ledger is the events' fast lane.
 *
 *     {"v":1,"ts":"2026-11-02T09:00:00Z","event":"dispatched","ticket":"T-0002","persona":"paul","model":"opus"}
 *     {"v":1,"ts":"2026-11-02T09:40:00Z","event":"phase","ticket":"T-0002","from":"build","to":"review"}
 *     {"v":1,"ts":"2026-11-02T09:45:00Z","event":"proof_ready","ticket":"T-0001"}
 *     {"v":1,"ts":"2026-11-02T10:00:00Z","event":"merged","ticket":"T-0001","persona":"tessa"}
 *     {"v":1,"ts":"2026-11-02T10:05:00Z","event":"archived","ticket":"T-0001"}
 *     {"v":1,"ts":"2026-11-02T09:41:00Z","event":"run_settled","ticket":"T-0002","persona":"paul","model":"opus","cost":1.17,"tokensIn":48000,"tokensOut":6000,"position":2,"length":5}
 *     {"v":1,"ts":"2026-11-02T09:41:05Z","event":"hold","ticket":"T-0002","persona":"ben","position":3,"length":5}
 *     {"v":1,"ts":"2026-11-02T11:00:00Z","event":"hold","ticket":"T-0002"}
 *
 * Cost rides the events that know it (`cost` in USD cents? No — the
 * house telemetry reports tokens; `cost` is the fractional dollar the
 * report computes, rounded to four digits).
 *
 * Attribution (concept §4.3): `dispatched` carries the persona and model
 * the dispatch resolved; `run_settled` (one line per COMPLETED run, with
 * the effective tokensIn/tokensOut/cost) is the aggregation source for
 * the ticket cards and the persona day budget — nothing else aggregates.
 * `phase`, `merged`, `archived` stay bare of persona/model/cost on
 * purpose: which persona "did" a merge is the chain's business, not a
 * fact the mover knows (a hand move would have to invent one), and the
 * same holds for `proof_ready` - a proof is no persona's doing.
 *
 * `hold` (req-274, the persona board concept §10): the chain's cursor moved
 * — from `ts` on the ticket is held by `persona` at chain `position` of
 * `length`; a `hold` without a persona closes the hold (the ticket left the
 * chain for a lifecycle column, or the board lost it). The dispatch pass
 * writes one whenever a ticket's derived holder or position changes, so
 * the time each holder held a ticket reads off consecutive lines, without
 * the store's git history. `run_settled` carries the run's chain
 * `position`/`length` too (absent on a run outside a chain).
 */

import type { TicketUsage } from '../../contracts/tickets';

export type LedgerEventKind = 'dispatched' | 'phase' | 'proof_ready' | 'merged' | 'archived' | 'run_settled' | 'hold';

const KINDS: ReadonlySet<string> = new Set<LedgerEventKind>(['dispatched', 'phase', 'proof_ready', 'merged', 'archived', 'run_settled', 'hold']);

export interface LedgerEvent {
  readonly kind: LedgerEventKind;
  readonly ts: string;
  readonly ticket: string;
  readonly persona: string | null;
  readonly model: string | null;
  /** Settled-run cost in dollars when known; null otherwise. */
  readonly cost: number | null;
  /**
   * The settled run's token counters (`run_settled` only); null on every
   * other event and on lines written before the counters existed.
   */
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly from: string | null;
  readonly to: string | null;
  /** req-274: the chain position (1-based) of a `hold` or a chain run's `run_settled`; null otherwise. */
  readonly position: number | null;
  /** req-274: the chain's length at that moment; null with `position`. */
  readonly length: number | null;
}

export interface LedgerWrite {
  readonly kind: LedgerEventKind;
  readonly ticket: string;
  readonly persona?: string | null;
  readonly model?: string | null;
  readonly cost?: number | null;
  /** The settled run's counters (`run_settled`); omitted otherwise. */
  readonly tokensIn?: number | null;
  readonly tokensOut?: number | null;
  readonly from?: string | null;
  readonly to?: string | null;
  /** req-274: the chain position and length (`hold`, a chain run's `run_settled`); omitted otherwise. */
  readonly position?: number | null;
  readonly length?: number | null;
}

export const LEDGER_FILE = 'tickets/_meta/ledger.jsonl';

const textOf = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const countOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
const positionOf = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null);
const costOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10_000) / 10_000 : null);

/** The JSON object of one line; null when the line is no object. */
function objectOf(raw: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The strict one-line wire shape; null refuses instead of guessing. */
export function parseLedgerLine(raw: string): LedgerEvent | null {
  const obj = objectOf(raw);
  const kind = obj?.['event'];
  const ts = textOf(obj?.['ts']);
  const ticket = textOf(obj?.['ticket']);
  if (obj === null || obj['v'] !== 1 || typeof kind !== 'string' || !KINDS.has(kind) || ts === null || ticket === null) {
    return null;
  }
  const position = positionOf(obj['position']);
  return {
    kind: kind as LedgerEventKind,
    ts,
    ticket,
    persona: textOf(obj['persona']),
    model: textOf(obj['model']),
    cost: costOf(obj['cost']),
    tokensIn: countOf(obj['tokensIn']),
    tokensOut: countOf(obj['tokensOut']),
    from: textOf(obj['from']),
    to: textOf(obj['to']),
    position,
    length: position === null ? null : positionOf(obj['length']),
  };
}

/** Reads the whole ledger tolerantly; torn lines are skipped. */
export function parseLedger(text: string): readonly LedgerEvent[] {
  const events: LedgerEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    const event = parseLedgerLine(line);
    if (event !== null) {
      events.push(event);
    }
  }
  return events;
}

/** The write's optional fields in wire order, an absent or empty one left out. */
function optionalFields(write: LedgerWrite): Record<string, string | number> {
  const fields: [string, string | number | null | undefined][] = [
    ['persona', write.persona],
    ['model', write.model],
    ['cost', write.cost],
    ['tokensIn', write.tokensIn],
    ['tokensOut', write.tokensOut],
    ['from', write.from],
    ['to', write.to],
    ['position', write.position],
    ['length', write.position == null ? null : write.length],
  ];
  return Object.fromEntries(fields.filter((field): field is [string, string | number] => field[1] != null && field[1] !== ''));
}

/** The one-line serialization an append-only writer emits. */
export function renderLedgerLine(ts: string, write: LedgerWrite): string {
  return `${JSON.stringify({ v: 1, ts, event: write.kind, ticket: write.ticket, ...optionalFields(write) })}\n`;
}

// --- projections over the settled runs (concept §4.3) ------------------------

/**
 * Per-ticket sums over the ledger's `run_settled` lines: the ticket
 * card's usage figure. Tokens always sum; `cost` sums the lines that
 * carry one and stays null when none does — a missing cost never poses
 * as 0. Dispatch/phase/merged/archived lines do not count.
 */
export function settledUsageByTicket(events: readonly LedgerEvent[]): Record<string, TicketUsage> {
  const byTicket = new Map<string, { tokensIn: number; tokensOut: number; cost: number | null; runs: number }>();
  for (const event of events) {
    if (event.kind !== 'run_settled') {
      continue;
    }
    const existing = byTicket.get(event.ticket) ?? { tokensIn: 0, tokensOut: 0, cost: null, runs: 0 };
    existing.runs++;
    existing.tokensIn += event.tokensIn ?? 0;
    existing.tokensOut += event.tokensOut ?? 0;
    if (event.cost !== null) {
      existing.cost = Math.round(((existing.cost ?? 0) + event.cost) * 10_000) / 10_000;
    }
    byTicket.set(event.ticket, existing);
  }
  return Object.fromEntries(byTicket);
}

/**
 * Per-persona cost of ONE day (the Team view's "Tageskosten gegen
 * Budget", concept §4.3): the summed `run_settled` costs whose `ts` sits
 * on `day` (`YYYY-MM-DD`, UTC — the same day convention the chain's
 * token budgets use). Personas without a settled run today are absent;
 * a persona whose runs reported no cost is absent too — the UI shows
 * "unknown" against the budget rather than a fake 0.
 */
export function personaDailyCosts(events: readonly LedgerEvent[], day: string): Record<string, number> {
  const byPersona = new Map<string, number>();
  for (const event of events) {
    if (event.kind !== 'run_settled' || event.cost === null || event.persona === null) {
      continue;
    }
    if (!event.ts.startsWith(day)) {
      continue;
    }
    byPersona.set(event.persona, Math.round(((byPersona.get(event.persona) ?? 0) + event.cost) * 10_000) / 10_000);
  }
  return Object.fromEntries(byPersona);
}
