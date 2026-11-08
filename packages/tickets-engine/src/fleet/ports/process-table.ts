/**
 * The machine's process table as the runner's core asks it (ADR-0075,
 * ADR-0096): is a worker alive, when was it born (the pid-reuse guard),
 * who listens on a port, the guarded tree-kill, and whether a detached
 * run's recorded workers are provably gone (D-34). The Node adapter is
 * `NodeProcessTable` over the probes in `procs.ts`.
 */
export interface ProcessTable {
  alive(pid: number): Promise<boolean>;
  /** The process' creation time in epoch ms, or null when it is gone. */
  startMs(pid: number): Promise<number | null>;
  /** The pid listening on a loopback port, or null (POSIX: always null). */
  listener(port: number): Promise<number | null>;
  /** The tree-kill, refused when the live process was born at another time than recorded. */
  killGuarded(pid: number, startedMs?: number): Promise<void>;
  /** The worker pids a run's folder and record name. */
  recordedPids(runDir: string, pid: number | null): Promise<readonly number[]>;
  /** None of the pids runs a process that could be the worker (a process born after `lastActivityMs` is a reused number). */
  gone(pids: readonly number[], lastActivityMs: number): Promise<boolean>;
}
