// i18n: catalog
/**
 * The Capacity band's pure model (board 7e, milestone 217): the header
 * value, the Slots row's chips and the Tranche-and-queue row. DOM-free, so
 * the band and its spec share it. The chips read the chain status's
 * `slots` (req-177); the queue reads the board; the tranche has no engine
 * source yet (req-179), so its reader is a seam that returns nothing.
 */
import type { ChainStatus, QuotaReliability, RunInfo, SlotStateName, SlotSummary } from '../../../../packages/tickets-engine/src/fleet/protocol';
import type { I18n } from '../../../../shared/i18n/types';
import { DEFAULT_PRIORITY_CONFIG, priorityClass, type BoardSnapshot } from '../../shared/tickets';
import { workGroups } from '../work-groups';
import { isLiveRun } from './team-model';

/** The surplus above which the chip says an upgrade is allowed (board 7e: `q 1.4` carries the chevron, `q 1.2` does not). */
export const UPGRADE_Q = 1.3;

/** What takes the share's place on a chip that has no quota reading to draw. */
export type SlotNote = 'unknown' | 'needs-login' | 'exhausted';

/** One slot as the Slots row draws it. */
export interface SlotChipModel {
  readonly id: string;
  readonly label: string;
  /** One dot per session the slot serves, busy ones first; true = busy. */
  readonly dots: readonly boolean[];
  /** The quota bar: the remaining share in whole percent, amber while estimated; null = no bar. */
  readonly bar: { readonly share: number; readonly estimated: boolean } | null;
  /** The surplus to one decimal; null = none shown (no bar, or no window can tell). */
  readonly q: number | null;
  /** True when `q` is above the upgrade mark. */
  readonly upgrade: boolean;
  /** When the headline window resets; null = not shown. */
  readonly resetsAt: Date | null;
  /** The state word that replaces the share (no bar, no q, no reset); null = the bar and share show. */
  readonly note: SlotNote | null;
}

function dateOf(iso: string | null): Date | null {
  if (iso === null) {
    return null;
  }
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at;
}

function noteOf(state: SlotStateName, reliability: QuotaReliability, remaining: number | null): SlotNote | null {
  if (state === 'needs-login') {
    return 'needs-login';
  }
  if (state === 'exhausted') {
    return 'exhausted';
  }
  return reliability === 'unknown' || remaining === null ? 'unknown' : null;
}

/** The chain status's slots as chips: busy dots, bar by reliability, q with its upgrade mark, the reset. */
export function slotChipsOf(slots: readonly SlotSummary[] | undefined): readonly SlotChipModel[] {
  return (slots ?? []).map((slot) => {
    const sessions = Math.max(slot.total ?? 0, slot.busy, 1);
    const dots = Array.from({ length: sessions }, (_, i) => i < slot.busy);
    const note = noteOf(slot.state, slot.reliability, slot.remaining);
    const bar =
      note === null && slot.remaining !== null
        ? { share: Math.round(Math.min(1, Math.max(0, slot.remaining)) * 100), estimated: slot.reliability === 'estimated' }
        : null;
    const q = bar !== null && slot.q !== null && Number.isFinite(slot.q) ? Math.round(slot.q * 10) / 10 : null;
    return {
      id: slot.id,
      label: slot.label,
      dots,
      bar,
      q,
      upgrade: q !== null && q > UPGRADE_Q,
      resetsAt: note === null || note === 'exhausted' ? dateOf(slot.resetsAt) : null,
      note,
    };
  });
}

const DAY_COUNT = (from: Date, to: Date): number =>
  Math.round((new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime() - new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()) / 86_400_000);

/**
 * A reset in the reader's locale, through `Intl` only: the time alone while it is today, weekday and time up to a
 * week ahead (`Mon 09:00`, the board's), the date and time beyond.
 */
export function resetTextOf(resetsAt: Date, now: Date, locale: string): string {
  const time: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  const days = DAY_COUNT(now, resetsAt);
  const options: Intl.DateTimeFormatOptions = days <= 0 ? time : days <= 7 ? { weekday: 'short', ...time } : { month: 'short', day: 'numeric', ...time };
  return new Intl.DateTimeFormat(locale, options).format(resetsAt);
}

/** A tranche as the row's left part draws it (req-179, board 10t's counters). */
export interface TrancheModel {
  /** Runs released so far in this tranche, and the tranche's size. */
  readonly runs: number;
  readonly size: number;
  readonly cost: number;
  readonly budget: number;
  /** What is left until the checkpoint: whichever of runs, share or time comes first. */
  readonly runsLeft: number;
  readonly msLeft: number;
}

/** The tranche part of the row. The chain status carries none until req-179, so the part stays empty. */
export function trancheOf(_chain: ChainStatus | null): TrancheModel | null {
  return null;
}

/**
 * The tickets waiting for the fleet to pull them (the Work panel's queued ideas), in the order the dispatcher takes
 * them: priority class, then the rightmost column, then position in the column (`planDispatch`).
 */
export function queuedIdsOf(snapshot: BoardSnapshot | null, runs: readonly RunInfo[]): readonly string[] {
  if (snapshot === null) {
    return [];
  }
  const queued = new Set(
    workGroups(snapshot, runs)
      .ideas.filter((row) => row.queued)
      .map((row) => row.card.id),
  );
  const priorities = snapshot.priorities ?? DEFAULT_PRIORITY_CONFIG;
  const waiting = snapshot.columns.flatMap((column, columnIndex) =>
    column.tickets.flatMap((card, position) => (queued.has(card.id) ? [{ card, columnIndex, position }] : [])),
  );
  return waiting
    .sort(
      (a, b) =>
        priorityClass(a.card.meta.priority, priorities) - priorityClass(b.card.meta.priority, priorities) ||
        b.columnIndex - a.columnIndex ||
        a.position - b.position,
    )
    .map((entry) => entry.card.id);
}

/** The queue part of the row: the ticket next in line and its place. Null while nothing is queued. */
export function queueHeadOf(queued: readonly string[]): { readonly ticketId: string; readonly position: number } | null {
  return queued.length === 0 ? null : { ticketId: queued[0]!, position: 1 };
}

/** The slots the pools carry (`poolSize`, capped by a probe), else the slots' own session counts; 0 = not known. */
export function sessionCapacityOf(chain: ChainStatus | null): number {
  const pools = Object.values(chain?.poolSize ?? {}).reduce((sum, size) => sum + (Number.isFinite(size) && size > 0 ? size : 0), 0);
  if (pools > 0) {
    return pools;
  }
  const slots = chain?.slots ?? [];
  return slots.length > 0 && slots.every((slot) => slot.total !== null) ? slots.reduce((sum, slot) => sum + (slot.total ?? 0), 0) : 0;
}

/** What the runs say alone: `1 stuck`, `2 running`; null while nothing runs. Works while the panel is closed. */
export function bandStatusOf(runs: readonly RunInfo[], i18n: I18n): string | null {
  const live = runs.filter(isLiveRun);
  const stuck = live.filter((run) => run.stuck === true).length;
  if (stuck > 0) {
    return i18n.t('capacity.status.stuck', { n: stuck });
  }
  return live.length > 0 ? i18n.t('capacity.status.running', { n: live.length }) : null;
}

/** The panel header's value (board 7e): `2 of 5 sessions · 1 queued`; what runs while the pools' size is unknown; null for neither. */
export function bandHeaderStatusOf(runs: readonly RunInfo[], chain: ChainStatus | null, queued: number, i18n: I18n): string | null {
  const total = sessionCapacityOf(chain);
  const base = total > 0 ? i18n.t('capacity.status.sessions', { live: runs.filter(isLiveRun).length, total }) : bandStatusOf(runs, i18n);
  if (queued <= 0) {
    return base;
  }
  return base === null ? i18n.t('capacity.status.queued', { queued }) : i18n.t('capacity.status.with_queued', { status: base, queued });
}
