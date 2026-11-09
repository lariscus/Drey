/**
 * Drey Service's log (req-164, req-165): one line per event with the
 * component as a field, kept three ways — a ring the window and `GET /log`
 * read, the live subscribers of `GET /log/stream`, and the files of a
 * {@link LogSink} (one per component per day). The log level of Settings →
 * Background service (`service.logLevel`) decides what reaches the files and
 * the ring, applied the moment it changes.
 */
import type { ComponentName } from './service-lock';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** `service.logLevel`: quiet = warnings and errors, normal = info and up, detailed = everything. */
export type LogThreshold = 'quiet' | 'normal' | 'detailed';

export type LogComponent = ComponentName | 'service' | 'window';

/** Where the lines are kept on disk (a port: {@link DailyLogFiles} over the file system). */
export interface LogSink {
  write(component: LogComponent, at: Date, line: string): void;
  /** Resolves once every line written so far is on disk. */
  flush(): Promise<void>;
}

export type LogListener = (line: string) => void;

const RANK: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };
const FLOOR: Readonly<Record<LogThreshold, number>> = { detailed: 0, normal: 1, quiet: 2 };
const RING_SIZE = 2000;

/** One service log line: time, level, component, message. */
export function formatServiceLogLine(at: Date, level: LogLevel, component: LogComponent, message: string): string {
  return `${at.toISOString()} ${level.padEnd(5)} ${component.padEnd(7)} ${message}`;
}

/** The component field of a formatted line. */
export function componentOfLine(line: string): string | undefined {
  return line.split(/\s+/)[2];
}

export interface ServiceLogOptions {
  readonly sink: LogSink;
  /** Mirrors every kept line (the entry: stdout). */
  readonly mirror?: (line: string) => void;
  readonly now?: () => Date;
}

export class ServiceLog {
  private readonly ring: string[] = [];
  private readonly listeners = new Set<LogListener>();
  private floor = FLOOR.normal;

  constructor(private readonly opts: ServiceLogOptions) {}

  /** Applies `service.logLevel`; an unknown value keeps normal. */
  setThreshold(threshold: LogThreshold): void {
    this.floor = FLOOR[threshold] ?? FLOOR.normal;
  }

  log(component: LogComponent, message: string, level: LogLevel = 'info'): void {
    if (RANK[level] < this.floor) {
      return;
    }
    const at = (this.opts.now ?? (() => new Date()))();
    const line = formatServiceLogLine(at, level, component, message);
    this.opts.mirror?.(line);
    this.ring.push(line);
    if (this.ring.length > RING_SIZE) {
      this.ring.splice(0, this.ring.length - RING_SIZE);
    }
    this.opts.sink.write(component, at, line);
    for (const listener of [...this.listeners]) {
      try {
        listener(line);
      } catch {
        this.listeners.delete(listener);
      }
    }
  }

  /** The last `count` lines, optionally of one component. */
  tail(count: number, component: string | null = null): readonly string[] {
    const lines = component === null ? this.ring : this.ring.filter((line) => componentOfLine(line) === component);
    return lines.slice(-count);
  }

  /** Listens to every kept line until the returned function is called. */
  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  flush(): Promise<void> {
    return this.opts.sink.flush();
  }
}
