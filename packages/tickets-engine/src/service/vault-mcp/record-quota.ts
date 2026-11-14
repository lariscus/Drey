/**
 * What one worker may still write into its persona's records (req-226): one
 * `memory_write` and one `journal_write` per run, like the closing round's
 * one lesson. A write that failed gives its turn back.
 */
export class RecordQuota {
  private readonly taken = new Set<string>();

  /** True once per tool; false when this worker already used it. */
  take(tool: string): boolean {
    if (this.taken.has(tool)) {
      return false;
    }
    this.taken.add(tool);
    return true;
  }

  giveBack(tool: string): void {
    this.taken.delete(tool);
  }
}
