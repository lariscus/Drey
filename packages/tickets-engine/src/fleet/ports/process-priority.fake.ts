import type { ProcessPriority } from './process-priority';

/** Records every lowered pid; `refuse` makes the OS say no. */
export class FakeProcessPriority implements ProcessPriority {
  readonly lowered: number[] = [];
  refuse = false;

  lower(pid: number): boolean {
    if (this.refuse) {
      return false;
    }
    this.lowered.push(pid);
    return true;
  }
}
