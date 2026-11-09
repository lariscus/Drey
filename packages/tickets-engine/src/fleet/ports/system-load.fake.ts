import type { LoadSample, SystemLoad } from './system-load';

/** A machine whose load a spec sets. */
export class FakeSystemLoad implements SystemLoad {
  next: LoadSample = { cpu: 10, memory: 30 };
  cpus = 8;

  sample(): LoadSample {
    return this.next;
  }

  cpuCount(): number {
    return this.cpus;
  }
}
