/**
 * How long each holder held a ticket (req-274, the persona board concept
 * §10), read off the ledger's `hold` lines: a line with a persona opens a
 * hold of that ticket at its position and closes the ticket's previous
 * one; a line without a persona only closes. A hold still open at the end
 * of the ledger runs until `now` — the ticket is still there.
 *
 * Pure over parsed ledger events; the lines of one ticket are taken in
 * file order (the append order), which is the order of their `ts`.
 */
import type { LedgerEvent } from './ledger';

/** One stretch a ticket sat with one holder at one chain position. */
export interface HoldSpan {
  readonly ticket: string;
  readonly persona: string;
  /** The chain position (1-based); null when the line named none (a chain that did not parse). */
  readonly position: number | null;
  readonly length: number | null;
  readonly from: string;
  /** When the hold ended; null while it is still open (it runs until `now`). */
  readonly to: string | null;
  /** The held time in milliseconds (never negative). */
  readonly ms: number;
}

interface OpenHold {
  readonly persona: string;
  readonly position: number | null;
  readonly length: number | null;
  readonly from: string;
}

function spanOf(ticket: string, open: OpenHold, to: string | null, endMs: number): HoldSpan {
  const startMs = Date.parse(open.from);
  const ms = Number.isNaN(startMs) || Number.isNaN(endMs) ? 0 : Math.max(0, endMs - startMs);
  return { ticket, persona: open.persona, position: open.position, length: open.length, from: open.from, to, ms };
}

/** Every hold the ledger records, closed ones first in ledger order, then the open ones (until `now`). */
export function holdSpans(events: readonly LedgerEvent[], now: string): readonly HoldSpan[] {
  const spans: HoldSpan[] = [];
  const open = new Map<string, OpenHold>();
  for (const event of events) {
    if (event.kind !== 'hold') {
      continue;
    }
    const previous = open.get(event.ticket);
    if (previous !== undefined) {
      spans.push(spanOf(event.ticket, previous, event.ts, Date.parse(event.ts)));
      open.delete(event.ticket);
    }
    if (event.persona !== null) {
      open.set(event.ticket, { persona: event.persona, position: event.position, length: event.length, from: event.ts });
    }
  }
  const nowMs = Date.parse(now);
  for (const [ticket, hold] of open) {
    spans.push(spanOf(ticket, hold, null, nowMs));
  }
  return spans;
}

/** The held time per persona, summed over every ticket (`you` included: what waited for the owner). */
export function heldMsByPersona(spans: readonly HoldSpan[]): ReadonlyMap<string, number> {
  const byPersona = new Map<string, number>();
  for (const span of spans) {
    byPersona.set(span.persona, (byPersona.get(span.persona) ?? 0) + span.ms);
  }
  return byPersona;
}

/** The held time per chain position, summed over every ticket; a hold without a position is left out. */
export function heldMsByPosition(spans: readonly HoldSpan[]): ReadonlyMap<number, number> {
  const byPosition = new Map<number, number>();
  for (const span of spans) {
    if (span.position !== null) {
      byPosition.set(span.position, (byPosition.get(span.position) ?? 0) + span.ms);
    }
  }
  return byPosition;
}
