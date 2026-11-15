/** A manual clock for the lease's keep-alive: `fire()` runs the armed callback. */
export class FakeTimers {
  armed: { fn: () => void; ms: number } | null = null;
  readonly delays: number[] = [];
  readonly set = (fn: () => void, ms: number): unknown => {
    this.armed = { fn, ms };
    this.delays.push(ms);
    return this.armed;
  };
  readonly clear = (handle: unknown): void => {
    if (this.armed === handle) {
      this.armed = null;
    }
  };

  async fire(): Promise<void> {
    const armed = this.armed;
    this.armed = null;
    armed?.fn();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  }
}
