/**
 * Lowering a heavy process's priority (req-180, ADR-0096): Windows' below
 * normal priority class, `nice` 10 on POSIX. Children a process starts
 * afterwards inherit it. The Node adapter is `NodeProcessPriority` over
 * `os.setPriority`.
 */
export interface ProcessPriority {
  /** True when the priority was lowered; false when the OS refused (a gone pid, no right). */
  lower(pid: number): boolean;
}
