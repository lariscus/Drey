/** What `ServiceHost.start` takes (req-164, req-165): the paths, the build, the spans and the seams. Types only. */
import type { Args, RunnerDeps, RunnerHandle } from '../fleet/runner/runner';
import type { Engine, EngineOptions } from '../server/engine';
import type { LegacyDeps } from './legacy';
import type { LogSink } from './service-log';
import type { WindowSpawn } from './window-processes';

export interface ServiceHostOptions {
  readonly home: string;
  readonly vaultPath: string;
  readonly clientDir: string;
  /** This build's stamp (`<builtAt>#<hash>`). */
  readonly build: string;
  /** The service's idle span at start. */
  readonly idleMs: number;
  /** `service.idleMinutes` applies live (the entry; a spec or `--idle-ms` keeps `idleMs` fixed). */
  readonly idleFromSettings?: boolean;
  /** Ends the process once the service has shut down; `process.exit` in the entry. */
  readonly exit: (code: number) => void;
  /** Mirrors every log line (the entry: stdout). */
  readonly stdout?: (line: string) => void;
  /** How often the host re-checks sleep and rewrites the lock; 5 s by default. */
  readonly tickMs?: number;
  /** The runner's own idle span (req-110), 15 min by default. */
  readonly runnerIdleMs?: number;
  /** Applies start with Windows (on = background mode and `service.autostart`); a spec leaves it out. */
  readonly applyAutostart?: (on: boolean) => Promise<void>;
  /** Starts the successor of an atomic restart (the entry: the same command again); a spec leaves it out. */
  readonly respawn?: () => void;
  /** Starts a window process (req-165); without it there is no tray and `/window/open` refuses. */
  readonly spawnWindow?: WindowSpawn;
  /** Test seams. */
  readonly createEngine?: (opts: EngineOptions) => Promise<Engine>;
  readonly engineOptions?: Partial<EngineOptions>;
  readonly startRunner?: (args: Args, deps: RunnerDeps) => Promise<RunnerHandle | null>;
  readonly legacy?: LegacyDeps;
  readonly now?: () => number;
  readonly logSink?: LogSink;
  readonly withDreyGraceMs?: number;
  readonly firstDreyWaitMs?: number;
}

/** The two spans of the with-Drey mode a spec may shorten (`ServiceStay`). */
export function staySpans(opts: ServiceHostOptions): { withDreyGraceMs?: number; firstDreyWaitMs?: number } {
  return {
    ...(opts.withDreyGraceMs === undefined ? {} : { withDreyGraceMs: opts.withDreyGraceMs }),
    ...(opts.firstDreyWaitMs === undefined ? {} : { firstDreyWaitMs: opts.firstDreyWaitMs }),
  };
}
