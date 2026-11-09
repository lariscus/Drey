import type { LoadSample, SystemLoad } from '../ports/system-load';

/** Whether the machine leaves the reserve: ok, or the load that does not. */
export type LoadVerdict = { readonly ok: true } | { readonly ok: false; readonly load: number };

/**
 * The CPU and memory reserve (req-180): a heavy seat is granted only while
 * the last sample leaves `reserve` percent of both free. The sample is the
 * short tick's; before the first one nothing is refused.
 */
export class LoadGuard {
  private last: LoadSample | null = null;

  constructor(private readonly load: SystemLoad) {}

  sample(): LoadSample {
    this.last = this.load.sample();
    return this.last;
  }

  get latest(): LoadSample | null {
    return this.last;
  }

  cpuCount(): number {
    return this.load.cpuCount();
  }

  verdict(reserve: number): LoadVerdict {
    if (this.last === null || reserve <= 0) {
      return { ok: true };
    }
    const load = Math.max(this.last.cpu ?? 0, this.last.memory);
    return load > 100 - reserve ? { ok: false, load } : { ok: true };
  }
}
