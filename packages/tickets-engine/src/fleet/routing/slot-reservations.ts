/**
 * Which live run holds which slot (req-177): a start reserves before its
 * worker spawns (two starts racing for the last session cannot both win),
 * a settled run releases, and the runs a restarted runner adopts reserve
 * again from their records.
 */
export class SlotReservations {
  private readonly bySlot = new Map<string, Set<string>>();
  private readonly byRun = new Map<string, string>();

  reserve(slotId: string, runId: string): void {
    if (this.byRun.get(runId) === slotId) {
      return;
    }
    this.release(runId);
    const runs = this.bySlot.get(slotId) ?? new Set<string>();
    runs.add(runId);
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
}
