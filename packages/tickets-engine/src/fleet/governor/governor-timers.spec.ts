import { describe, expect, it } from 'vitest';
import { GovernorTicker, type GovernorTimers } from './governor-timers';

class ManualTimers implements GovernorTimers {
  readonly armed = new Map<number, () => void>();
  every(ms: number, fn: () => void): () => void {
    this.armed.set(ms, fn);
    return () => this.armed.delete(ms);
  }
}

describe('GovernorTicker', () => {
  it('ticks once at start, then on both periods, until stopped', async () => {
    const timers = new ManualTimers();
    const calls: string[] = [];
    const ticker = new GovernorTicker(timers, { tickMs: 5_000, sweepMs: 30_000 });
    ticker.start({ tick: () => calls.push('tick'), sweep: () => Promise.resolve(void calls.push('sweep')) });
    timers.armed.get(5_000)?.();
    timers.armed.get(30_000)?.();
    await Promise.resolve();
    expect(calls).toEqual(['tick', 'tick', 'sweep']);
    ticker.stop();
    expect(timers.armed.size).toBe(0);
  });
});
