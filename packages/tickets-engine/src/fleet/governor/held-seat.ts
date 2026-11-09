import type { SeatLease } from './resource-governor';

/** What a held seat reports back to: the governor. */
export interface SeatHost {
  adoptSeat(id: number, pid: number): void;
  releaseSeat(id: number): void;
}

/** One held seat as its taker sees it (req-180). */
export class HeldSeat implements SeatLease {
  constructor(
    private readonly id: number,
    private readonly host: SeatHost,
    readonly env: Readonly<Record<string, string>>,
    readonly devPort: number | null,
  ) {}

  adopt(pid: number): void {
    this.host.adoptSeat(this.id, pid);
  }

  release(): void {
    this.host.releaseSeat(this.id);
  }
}
