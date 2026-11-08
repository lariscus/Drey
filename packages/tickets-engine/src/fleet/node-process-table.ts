import type { ProcessTable } from './ports/process-table';
import { killTreeGuarded, listenerPid, processAlive, processStartMs, recordedWorkerPids, workerGone, type ExecFn } from './procs';

/** The runner's `ProcessTable` port over the probes of `procs.ts` and their exec (no shell, the arguments kept apart). */
export class NodeProcessTable implements ProcessTable {
  constructor(private readonly exec: ExecFn) {}

  alive(pid: number): Promise<boolean> {
    return processAlive(pid, this.exec);
  }

  startMs(pid: number): Promise<number | null> {
    return processStartMs(pid, this.exec);
  }

  listener(port: number): Promise<number | null> {
    return listenerPid(port, this.exec);
  }

  async killGuarded(pid: number, startedMs?: number): Promise<void> {
    await killTreeGuarded(pid, this.exec, startedMs);
  }

  recordedPids(runDir: string, pid: number | null): Promise<readonly number[]> {
    return recordedWorkerPids(runDir, pid);
  }

  gone(pids: readonly number[], lastActivityMs: number): Promise<boolean> {
    return workerGone(pids, lastActivityMs, this.exec);
  }
}
