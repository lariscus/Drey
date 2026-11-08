/**
 * Starting a worker process (ADR-0096): the one bit of a child process the
 * adapters need, and the function that starts one. The Node implementation
 * is `nodeSpawnFn` in `procs.ts`; the specs pass scripted processes.
 */

/** The one bit of `ChildProcess` the runner needs, shaped for tests. */
export interface RunnerProcess {
  readonly pid: number;
  /** Writes to the worker's stdin (the steer ladder's injection rung). */
  write(text: string): void;
  /** Closes stdin — a stream-json worker sees the conversation end. */
  endInput(): void;
  onStdout(cb: (chunk: string) => void): void;
  onStderr(cb: (chunk: string) => void): void;
  /** Resolves once the process is gone (exit or signal). */
  onExit(cb: (code: number | null) => void): void;
  /** Kill-tree, unguarded: the runner spawned this child itself. */
  killTree(): Promise<void>;
}

/** Starts a worker process (the ADR's `ProcessSpawner`). */
export type SpawnFn = (cmd: string, args: readonly string[], opts: { readonly cwd: string; readonly env?: Readonly<Record<string, string>> }) => RunnerProcess;

export type ProcessSpawner = SpawnFn;
