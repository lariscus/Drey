import type { SeatClass, SeatHolder } from '../protocol-governor';

/** One seat as the table keeps it. */
export interface SeatEntry {
  readonly id: number;
  readonly cls: SeatClass;
  readonly holder: SeatHolder;
}

/**
 * The seats per class and who holds which (req-180). It records; whether a
 * seat may be taken is the governor's decision.
 */
export class SeatTable {
  private next = 1;
  private readonly seats = new Map<number, SeatEntry>();

  take(cls: SeatClass, holder: SeatHolder): number {
    const id = this.next++;
    this.seats.set(id, { id, cls, holder });
    return id;
  }

  /** The seat's process is known now. */
  setPid(id: number, pid: number): void {
    const seat = this.seats.get(id);
    if (seat !== undefined) {
      this.seats.set(id, { ...seat, holder: { ...seat.holder, pid } });
    }
  }

  /** The released entry, or null when it was not held (a second release). */
  release(id: number): SeatEntry | null {
    const seat = this.seats.get(id) ?? null;
    this.seats.delete(id);
    return seat;
  }

  has(id: number): boolean {
    return this.seats.has(id);
  }

  busy(cls: SeatClass): number {
    return this.entries(cls).length;
  }

  entries(cls?: SeatClass): readonly SeatEntry[] {
    return [...this.seats.values()].filter((seat) => cls === undefined || seat.cls === cls);
  }

  holders(cls: SeatClass): readonly SeatHolder[] {
    return this.entries(cls).map((seat) => seat.holder);
  }
}
