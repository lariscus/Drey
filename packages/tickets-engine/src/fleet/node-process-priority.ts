/**
 * The governor's `ProcessPriority` over `os.setPriority` (req-180).
 * `PRIORITY_BELOW_NORMAL` is Windows' BELOW_NORMAL_PRIORITY_CLASS and
 * `nice` 10 on POSIX; a process the lowered one starts later inherits it
 * (Windows hands a below-normal parent's class to its children). Node
 * reaches this without a native helper; a Job Object (a CPU rate cap, I/O
 * priority) would need one and is not used.
 */
import * as os from 'node:os';
import type { ProcessPriority } from './ports/process-priority';

export class NodeProcessPriority implements ProcessPriority {
  lower(pid: number): boolean {
    try {
      os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
      return true;
    } catch {
      return false;
    }
  }
}
