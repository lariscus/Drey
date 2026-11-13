import type { CapabilityClass } from '../protocol';

/** What a live session holds on its slot (req-170): the model, its class and its weight against the caps. */
export interface Seat {
  readonly model: string | null;
  readonly class: CapabilityClass | null;
  readonly cost: number;
}

const BARE: Seat = { model: null, class: null, cost: 0 };

/**
 * Which live run holds which slot (req-177) and what it weighs there
 * (req-170): a start reserves before its worker spawns (two starts racing
 * for the last session cannot both win), a settled run releases, and the
 * runs a restarted runner adopts reserve again from their records. Only
 * active sessions are here — a queued task holds nothing.
 */
export class SlotReservations {
  private readonly bySlot = new Map<string, Map<string, Seat>>();
  private readonly byRun = new Map<string, string>();

  /** Holds the slot for the run; a repeated reserve keeps the seat unless it names one. */
  reserve(slotId: string, runId: string, seat?: Seat): void {
    if (this.byRun.get(runId) === slotId) {
      if (seat !== undefined) {
        this.bySlot.get(slotId)?.set(runId, seat);
      }
      return;
    }
    this.release(runId);
    const runs = this.bySlot.get(slotId) ?? new Map<string, Seat>();
    runs.set(runId, seat ?? BARE);
    this.bySlot.set(slotId, runs);
    this.byRun.set(runId, slotId);
  }

  /** The slot the run held, or null when it held none. */
  release(runId: string): string | null {
    const slotId = this.byRun.get(runId);
    if (slotId === undefined) {
      return null;
    }
    this.byRun.delete(runId);
    this.bySlot.get(slotId)?.delete(runId);
    return slotId;
  }

  busy(slotId: string): number {
    return this.bySlot.get(slotId)?.size ?? 0;
  }

  slotOf(runId: string): string | null {
    return this.byRun.get(runId) ?? null;
  }

  /** The summed cost factors of the slot's sessions. */
  costOn(slotId: string): number {
    return [...(this.bySlot.get(slotId)?.values() ?? [])].reduce((sum, seat) => sum + seat.cost, 0);
  }

  /** The summed cost factors of every active session. */
  totalCost(): number {
    return [...this.bySlot.keys()].reduce((sum, slotId) => sum + this.costOn(slotId), 0);
  }

  /** req-287: how many sessions of a class run on every slot (the class's `at most N`). */
  sessionsOfClass(name: CapabilityClass): number {
    let count = 0;
    for (const runs of this.bySlot.values()) {
      count += [...runs.values()].filter((seat) => seat.class === name).length;
    }
    return count;
  }

  /** How many sessions of a model run on the slot. */
  sessionsOf(slotId: string, model: string): number {
    return [...(this.bySlot.get(slotId)?.values() ?? [])].filter((seat) => seat.model === model).length;
  }
}
