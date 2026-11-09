/**
 * The resource governor's wire types (req-180, ADR-0092 later change,
 * ADR-0096's `ResourceGovernor` port): the Load settings it reads, and the
 * status `GET /governor` answers and the `governor` event carries — what
 * the service window's Governor block (board 8a) draws.
 */

/** The class of a seat: `light` for model runs, `heavy` for tests, builds, dev servers and browsers. */
export type SeatClass = 'light' | 'heavy';

/** What a heavy seat is for, as the log and the Governor block name it. */
export type HeavyTask = 'tests' | 'build' | 'dev server' | 'browser' | 'command';

/** Settings → Background service's Load group (board 8c), as the governor reads it live. */
export interface GovernorSettings {
  /** `service.load.heavySeats`: heavy tasks at once. */
  readonly heavySeats: number;
  /** `service.load.reserve`: percent of CPU and memory kept free. */
  readonly reserve: number;
  /** `service.load.lowPriority`: heavy processes run below normal priority. */
  readonly lowPriority: boolean;
  /** `service.load.quietHours`: `22:00 – 07:00`, or '' for none. */
  readonly quietHours: string;
}

export const DEFAULT_GOVERNOR_SETTINGS: GovernorSettings = { heavySeats: 2, reserve: 25, lowPriority: true, quietHours: '' };

/** The dev-server ports the governor leases, one per worktree (inclusive). */
export interface PortRange {
  readonly from: number;
  readonly to: number;
}

export const DEFAULT_DEV_PORTS: PortRange = { from: 4300, to: 4399 };

/** Who holds a seat. */
export interface SeatHolder {
  readonly runId: string;
  readonly ticket: string;
  readonly task: HeavyTask | 'model run';
  /** ISO. */
  readonly since: string;
  /** The process the seat is for, once it runs; null before. */
  readonly pid: number | null;
}

/** A heavy task the governor holds back, and why. */
export interface GovernorWait {
  readonly runId: string;
  readonly ticket: string;
  readonly task: HeavyTask;
  /** `2 of 2 heavy seats busy`, `quiet hours until 07:00`, `load 91 % above the reserve`. */
  readonly reason: string;
  /** ISO. */
  readonly since: string;
}

/** One leased dev-server port. */
export interface DevServerLease {
  readonly port: number;
  readonly ticket: string;
  readonly runId: string;
  /** A process listens on the port (Windows only; POSIX cannot tell and says false). */
  readonly listening: boolean;
}

/** What `GET /governor` answers and the `governor` event carries. */
export interface GovernorStatus {
  readonly heavy: { readonly busy: number; readonly total: number; readonly holders: readonly SeatHolder[] };
  /** Light seats: the live workers; total = the slots' sessions summed, null when a slot has no cap. */
  readonly light: { readonly busy: number; readonly total: number | null };
  /** The last sample in percent (null before the first); `reserve` is the setting. */
  readonly load: { readonly cpu: number | null; readonly memory: number | null; readonly reserve: number };
  readonly lowPriority: boolean;
  readonly quietHours: string;
  /** The end of the quiet span (`07:00`) while it holds; null outside it. */
  readonly quietUntil: string | null;
  readonly waiting: readonly GovernorWait[];
  readonly devServers: readonly DevServerLease[];
}
