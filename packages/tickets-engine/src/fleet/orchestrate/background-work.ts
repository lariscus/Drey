/**
 * Work the supervisor starts on its own (event folds, persists, a worker
 * exit's settle, a pause's interrupt): remembered so {@link idle} can wait
 * for it. A caller about to remove the fleet root or a vault awaits `idle`
 * first — that work writes files, and one still in flight lands in a folder
 * being deleted (docs/testing-flakes.md).
 */
export class BackgroundWork {
  private readonly pending = new Set<Promise<unknown>>();

  track(work: Promise<unknown>): void {
    this.pending.add(work);
    const forget = (): void => {
      this.pending.delete(work);
    };
    work.then(forget, forget);
  }

  async idle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }
}
