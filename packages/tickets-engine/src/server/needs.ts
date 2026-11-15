/**
 * The remote's "Needs you" list (req-66, ADR-0086): everything that
 * waits on the owner, derived from one board snapshot and the fleet's
 * runs. Pure — the gateway calls it per request, nothing is stored.
 *
 * Order: questions, permissions, red gates, failed runs, then the
 * tickets sitting in a checkpoint column; oldest first within a kind.
 * The E8 report card is not derived here — it needs the ticket files'
 * `## Report` sections, so the port sweeps those (drey-port.ts) and packs
 * each item through `reportNeedOf` below. The E9 Bescheid card is derived
 * here too, on the chain's cursor (req-257, `notifyNeedsOf` below).
 */
import type { NeedItem, NeedKind } from '../contracts/remote-protocol';
import type { ScoutReport } from '../contracts/scout';
import { scoutNeedText } from '../contracts/scout';
import type { BoardSnapshot, TicketCard } from '../contracts/tickets';
import { slugStatusKey } from '../core/status-comment';
import type { OpenStatusItem } from '../core/status-log';
import type { RunInfo, RunState } from '../fleet/protocol';

const LIVE: ReadonlySet<RunState> = new Set(['starting', 'running', 'stopping', 'detached']);
const KIND_ORDER: readonly NeedKind[] = ['question', 'permission', 'needs-decision', 'blocked', 'manual', 'red-gate', 'failed', 'checkpoint'];

/** How many open decisions and blockers (E7) one list carries at most: a neglected board must not flood the phone. */
export const STATUS_NEEDS_CAP = 20;

/** One open decision or blocker as a Needs-you line; a key made from the words themselves adds nothing to read. */
export function statusNeedOf(card: TicketCard, phase: string, item: Pick<OpenStatusItem, 'verb' | 'key' | 'text' | 'since'>): NeedItem {
  const showKey = item.key !== null && slugStatusKey(item.text) !== item.key;
  return {
    kind: item.verb,
    ticketId: card.id,
    title: titleOf(card),
    phase,
    runId: null,
    text: showKey ? `[${item.key}] ${item.text}`.trim() : item.text,
    since: item.since,
  };
}

interface Placed {
  readonly card: TicketCard;
  readonly phase: string;
}

export function needsOf(board: BoardSnapshot, runs: readonly RunInfo[]): readonly NeedItem[] {
  const placed = new Map<string, Placed>();
  for (const column of board.columns) {
    for (const card of column.tickets) {
      placed.set(card.id, { card, phase: column.phase.id });
    }
  }

  const latest = new Map<string, RunInfo>();
  for (const run of runs) {
    const seen = latest.get(run.ticketId);
    if (seen === undefined || run.startedAt > seen.startedAt) {
      latest.set(run.ticketId, run);
    }
  }

  const items: NeedItem[] = [];
  const hasLiveRun = new Set<string>();
  for (const run of latest.values()) {
    const at = placed.get(run.ticketId);
    if (at === undefined) {
      continue;
    }
    const base = { ticketId: run.ticketId, title: titleOf(at.card), phase: at.phase, runId: run.id };
    if (LIVE.has(run.state)) {
      hasLiveRun.add(run.ticketId);
      const waiting = run.waiting ?? null;
      if (waiting !== null) {
        items.push({
          ...base,
          kind: waiting.kind,
          text: waiting.text,
          since: waiting.since,
          ...(waiting.questions !== undefined ? { questions: waiting.questions } : {}),
          ...(waiting.shaped !== undefined ? { shaped: waiting.shaped } : {}),
        });
      }
      continue;
    }
    // A settled run only needs the owner while its ticket still sits in
    // the phase it ran in — a moved ticket has been dealt with.
    if (run.phase !== undefined && run.phase !== null && run.phase !== at.phase) {
      continue;
    }
    if (run.gateResult === 'red' || run.gateFailure !== null) {
      items.push({ ...base, kind: 'red-gate', text: run.gateFailure ?? 'the gate is red', since: run.endedAt });
    } else if (run.state === 'failed') {
      items.push({ ...base, kind: 'failed', text: run.lastError ?? 'the run failed', since: run.endedAt });
    }
  }

  // E10-6: a ticket parked at a manual step waits for the owner, wherever it sits.
  for (const { card, phase } of placed.values()) {
    const awaiting = card.meta.awaiting;
    if (awaiting !== undefined && !hasLiveRun.has(card.id)) {
      items.push({
        kind: 'manual',
        ticketId: card.id,
        title: titleOf(card),
        phase,
        runId: null,
        text: `a manual step waits for ${awaiting}`,
        since: card.meta.entered[phase] ?? null,
      });
    }
  }

  const checkpoints = new Set(board.checkpoints);
  for (const { card, phase } of placed.values()) {
    if (checkpoints.has(phase) && !hasLiveRun.has(card.id) && card.meta.awaiting === undefined) {
      items.push({
        kind: 'checkpoint',
        ticketId: card.id,
        title: titleOf(card),
        phase,
        runId: null,
        text: '',
        since: card.meta.entered[phase] ?? null,
      });
    }
  }

  for (const status of (board.openStatus ?? []).slice(0, STATUS_NEEDS_CAP)) {
    const at = placed.get(status.ticketId);
    if (at !== undefined) {
      items.push(statusNeedOf(at.card, at.phase, status));
    }
  }

  return items.sort((a, b) => {
    const byKind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    if (byKind !== 0) {
      return byKind;
    }
    return (a.since ?? '￿').localeCompare(b.since ?? '￿');
  });
}

/**
 * E8 (concept §5.6): the report card's pure shape — one scout ticket's
 * parsed `## Report` as a "Needs you" line, the report itself riding
 * along for the card's detail view. The caller sweeps the board for
 * `form: scout` tickets, reads each file and parses the section; this
 * builder only packs the item. A promoted ticket never reaches here —
 * the caller filters on the form, since the chapter stays in the file
 * as history after the flip to ship.
 */
export function reportNeedOf(card: TicketCard, phase: string, report: ScoutReport): NeedItem {
  return {
    kind: 'report',
    ticketId: card.id,
    title: titleOf(card),
    phase,
    runId: null,
    text: scoutNeedText(report),
    since: report.writtenAt === '' ? null : report.writtenAt,
    report,
  };
}

/**
 * The Bescheid cards on the chain's cursor (E9, req-257): an entry marked
 * `(notify)` lands a card in Needs you once it is done — while the cursor
 * stands on the position right after it (the next step has not ended yet).
 * A notify on the chain's last entry has nothing after it and never fires.
 * Pure over the snapshot; the store keeps no time of the cursor's move, so
 * the card carries none.
 */
export function notifyNeedsOf(board: BoardSnapshot): readonly NeedItem[] {
  const terminal = board.pipeline[board.pipeline.length - 1]?.id ?? null;
  const items: NeedItem[] = [];
  for (const column of board.columns) {
    if (column.phase.id === terminal || ['inbox', 'prioritized'].includes(column.phase.id)) {
      continue;
    }
    for (const card of column.tickets) {
      const chain = card.meta.chain ?? [];
      const at = card.meta.at ?? 1;
      const done = chain[at - 2];
      if (at < 2 || at > chain.length || done === undefined || !done.notify) {
        continue;
      }
      items.push({ kind: 'notify', ticketId: card.id, title: titleOf(card), phase: column.phase.id, runId: null, text: `${done.persona} finished position ${at - 1} of ${chain.length}`, since: null });
    }
  }
  return items;
}

function titleOf(card: TicketCard): string {
  return card.meta.title ?? card.id;
}
