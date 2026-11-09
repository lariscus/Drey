/**
 * The resource governor's port (req-180, ADR-0096): every task that spawns
 * work takes a seat of a class before it starts and gives it back when it
 * ends. The orchestration asks it through its own small interfaces
 * (`WorkerSeats` in worker-launcher, `GateSeats` in gate-runner); the
 * composition root hands this port to them. The one implementation is
 * `SeatGovernor`.
 */
import type { GovernorStatus, HeavyTask } from '../protocol-governor';

/** A held seat: the environment its process starts with, the pid once it runs, the release. */
export interface SeatLease {
  /** `DREY_DEV_PORT` (light) and the parallelism variables (both classes). */
  readonly env: Readonly<Record<string, string>>;
  /** The dev-server port of the run's worktree; null when the range is used up or for a heavy seat. */
  readonly devPort: number | null;
  /** The seat's process started: a heavy one drops to low priority (when the setting says so); a gone pid frees the seat later. */
  adopt(pid: number): void;
  /** Gives the seat back; a second call does nothing. */
  release(): void;
}

/** Who asks for a seat. */
export interface SeatAsk {
  readonly runId: string;
  readonly ticket: string;
  /** The run's worktree: one dev-server port per worktree. */
  readonly worktree: string;
}

export interface HeavyAsk extends SeatAsk {
  readonly task: HeavyTask;
  /** The wait's reason, each time it changes (`2 of 2 heavy seats busy`); null when the seat is granted. */
  readonly onWait?: (reason: string | null) => void;
  /** True once the run stopped: the wait ends with a rejection. */
  readonly cancelled?: () => boolean;
}

/** One live run as a restart finds it: its worker re-takes its light seat, its worktree its port. */
export interface SeatSeed extends SeatAsk {
  readonly pid: number | null;
  readonly devPort: number | null;
}

export interface ResourceGovernor {
  /** A model run's seat: never waits (the slots and the pool already bound model runs). */
  light(ask: SeatAsk): SeatLease;
  /** A heavy seat: resolves once the count, the quiet hours and the load allow it. */
  heavy(ask: HeavyAsk): Promise<SeatLease>;
  /** The run settled: its dev-server port and any dev-server seat go back. */
  runSettled(runId: string): void;
  /** The live runs a restart found. */
  seed(runs: readonly SeatSeed[]): void;
  status(): GovernorStatus;
  /** Samples the load and re-checks the waiting tasks (the short tick). */
  tick(): void;
  /** Frees the seats of gone processes and follows the dev servers (the long tick). */
  sweep(): Promise<void>;
}
