/**
 * The governor's `SystemLoad` over Node's `os` (req-180): CPU busy share
 * from the difference of `os.cpus()` times between two samples, memory as
 * `1 − freemem / totalmem` (Windows: available physical memory; Linux:
 * libuv reads `MemAvailable`).
 */
import * as os from 'node:os';
import type { LoadSample, SystemLoad } from './ports/system-load';

interface CpuTotals {
  readonly busy: number;
  readonly total: number;
}

function cpuTotals(): CpuTotals {
  let busy = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const { user, nice, sys, irq, idle } = cpu.times;
    busy += user + nice + sys + irq;
    total += user + nice + sys + irq + idle;
  }
  return { busy, total };
}

export class NodeSystemLoad implements SystemLoad {
  private previous: CpuTotals | null = null;

  sample(): LoadSample {
    const now = cpuTotals();
    const before = this.previous;
    this.previous = now;
    const span = before === null ? 0 : now.total - before.total;
    const cpu = before === null || span <= 0 ? null : Math.round(((now.busy - before.busy) / span) * 100);
    const total = os.totalmem();
    const memory = total > 0 ? Math.round((1 - os.freemem() / total) * 100) : 0;
    return { cpu: cpu === null ? null : Math.min(100, Math.max(0, cpu)), memory };
  }

  cpuCount(): number {
    return Math.max(1, typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length);
  }
}
