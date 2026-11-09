import type { Clock } from '../ports/clock';
import type { BurnRateBasis, BurnRateReading, BurnRateSlotReading, QuotaWindow, SlotView } from '../protocol';
import type { BurnRateDayBook } from './burn-rate-day';
import type { SessionCost, SessionRecords } from './ledgers';
import type { ShareEstimates } from './reserve-guard';

/** The weekly window's name on every quota source. */
export const WEEK_WINDOW = '7d';

/** Where the meter reads the slots (`SlotRegistry` satisfies it). */
export interface SlotViews {
  views(): readonly SlotView[];
}

export interface BurnRateMeterDeps {
  readonly slots: SlotViews;
  /** Every run record (the session book): today's runs of a slot without a weekly reading. */
  readonly records: SessionRecords;
  /** What a run takes of a slot's week, learned from earlier runs (`RunShareTracker`). */
  readonly shares: ShareEstimates;
  readonly book: BurnRateDayBook;
  readonly clock: Clock;
}

/** A weekly window with a known remaining share; null when the slot reads none. */
function weekOf(view: SlotView): (QuotaWindow & { readonly remaining: number }) | null {
  const week = view.windows.find((window) => window.name === WEEK_WINDOW && window.remaining !== null);
  return week === undefined ? null : (week as QuotaWindow & { readonly remaining: number });
}

const round = (value: number): number => Math.round(value * 10_000) / 10_000;

function basisOf(slots: readonly BurnRateSlotReading[]): BurnRateBasis | null {
  if (slots.length === 0) {
    return null;
  }
  const measured = slots.filter((slot) => slot.basis === 'measured').length;
  return measured === slots.length ? 'measured' : measured === 0 ? 'estimated' : 'mixed';
}

/**
 * Today's burn rate (req-181): the share of the weekly quota spent since the
 * UTC day began, over all slots. A slot that reads its weekly window counts
 * every drop of the remaining share since the day's first reading (a rise —
 * a rolling window letting go of old use — is not spending, a window past
 * its reset starts again from its new reading); a slot that reads none
 * counts its runs started today at the share a run takes of its week
 * (`RunShareTracker`'s estimate). The figure is the mean over the counted
 * slots — each slot's week weighs the same — and an implied slot (a
 * provider `service.json` names no slot for) counts only once it ran today.
 */
export class BurnRateMeter {
  constructor(private readonly deps: BurnRateMeterDeps) {}

  /** A slot's view changed: its weekly reading goes into today's book (the first one of the day is the start). */
  observe(view: SlotView): void {
    this.deps.book.roll(this.today());
    this.note(view);
  }

  reading(): BurnRateReading {
    const day = this.today();
    this.deps.book.roll(day);
    const slots: BurnRateSlotReading[] = [];
    for (const view of this.deps.slots.views()) {
      const slot = this.slotReading(view, day);
      if (slot !== null) {
        slots.push(slot);
      }
    }
    const spent = slots.length === 0 ? 0 : slots.reduce((sum, slot) => sum + slot.spent, 0) / slots.length;
    return { day, spent: round(spent), basis: basisOf(slots), slots };
  }

  /** One slot's part; null for an implied slot that has not run today. */
  private slotReading(view: SlotView, day: string): BurnRateSlotReading | null {
    const week = weekOf(view);
    if (week !== null) {
      this.note(view);
      const spent = this.deps.book.entry(view.id)?.spent ?? 0;
      return view.implied && spent === 0 && this.runsToday(view.id, day).length === 0 ? null : { slot: view.id, spent: round(spent), basis: week.reliability === 'measured' ? 'measured' : 'estimated' };
    }
    const runs = this.runsToday(view.id, day);
    if (view.implied && runs.length === 0) {
      return null;
    }
    const spent = runs.reduce((sum, run) => sum + this.deps.shares.shareOf({ ticket: run.ticketId, persona: run.persona ?? null }, view.id, WEEK_WINDOW), 0);
    return { slot: view.id, spent: round(spent), basis: 'estimated' };
  }

  /** Writes the slot's newest weekly reading into the book: the day's first, a drop, or a fresh start after a reset. */
  private note(view: SlotView): void {
    const week = weekOf(view);
    if (week === null) {
      return;
    }
    const { book } = this.deps;
    const entry = book.entry(view.id);
    const reset = entry?.resetsAt != null && Date.parse(entry.resetsAt) <= this.deps.clock.now().getTime();
    if (entry === null || reset) {
      book.setEntry(view.id, { last: week.remaining, spent: 0, resetsAt: week.resetsAt });
    } else if (week.remaining !== entry.last || week.resetsAt !== entry.resetsAt) {
      book.setEntry(view.id, { last: week.remaining, spent: entry.spent + Math.max(0, entry.last - week.remaining), resetsAt: week.resetsAt });
    }
  }

  private runsToday(slotId: string, day: string): readonly SessionCost[] {
    return this.deps.records.all().filter((run) => run.slot?.id === slotId && run.startedAt.slice(0, 10) === day);
  }

  private today(): string {
    return this.deps.clock.now().toISOString().slice(0, 10);
  }
}
