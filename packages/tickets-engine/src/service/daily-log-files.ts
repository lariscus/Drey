/**
 * The service log on disk (req-165, board 8c's Logs group): one file per
 * component per day under `<home>/logs/` — `runner-2026-11-09.log` —
 * kept 14 days, plus the combined `service.log` (capped at 1 MB) that
 * `--status` users and the start diagnosis read. Writes are queued so the
 * order holds and a failed write never reaches the logger's caller.
 */
import type { LogComponent, LogSink } from './service-log';

/** What the files need of the machine (the node adapter: `node-log-file-system.ts`). */
export interface LogFileSystem {
  append(file: string, text: string): Promise<void>;
  size(file: string): Promise<number | null>;
  /** Keeps only the last `bytes` of the file. */
  keepTail(file: string, bytes: number): Promise<void>;
  list(dir: string): Promise<readonly string[]>;
  remove(file: string): Promise<void>;
  mkdir(dir: string): Promise<void>;
  join(...parts: string[]): string;
}

export const LOG_DIR = 'logs';
export const LOG_KEEP_DAYS = 14;
export const COMBINED_LOG = 'service.log';
const COMBINED_CAP = 1024 * 1024;
const FILE_NAME = /^([a-z]+)-(\d{4}-\d{2}-\d{2})\.log$/;

/** `YYYY-MM-DD` of a local day. */
export function dayOf(at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** The files of `names` older than `keepDays` days before `today` (a `YYYY-MM-DD`). */
export function expiredLogFiles(names: readonly string[], today: string, keepDays: number): readonly string[] {
  const cutoff = new Date(`${today}T00:00:00`);
  cutoff.setDate(cutoff.getDate() - keepDays);
  const limit = dayOf(cutoff);
  return names.filter((name) => {
    const match = FILE_NAME.exec(name);
    return match !== null && match[2]! < limit;
  });
}

export class DailyLogFiles implements LogSink {
  private chain: Promise<void> = Promise.resolve();
  private prunedFor: string | null = null;
  private readonly dir: string;

  constructor(
    private readonly home: string,
    private readonly fs: LogFileSystem,
  ) {
    this.dir = fs.join(home, LOG_DIR);
  }

  /** The folder Settings → Background service names and opens. */
  get folder(): string {
    return this.dir;
  }

  write(component: LogComponent, at: Date, line: string): void {
    const day = dayOf(at);
    this.chain = this.chain
      .then(async () => {
        await this.fs.mkdir(this.dir);
        await this.fs.append(this.fs.join(this.dir, `${component}-${day}.log`), `${line}\n`);
        await this.appendCombined(line);
        await this.pruneOnce(day);
      })
      .catch(() => undefined);
  }

  flush(): Promise<void> {
    return this.chain;
  }

  private async appendCombined(line: string): Promise<void> {
    const file = this.fs.join(this.home, COMBINED_LOG);
    await this.fs.append(file, `${line}\n`);
    const size = await this.fs.size(file);
    if (size !== null && size > COMBINED_CAP) {
      await this.fs.keepTail(file, COMBINED_CAP / 2);
    }
  }

  private async pruneOnce(day: string): Promise<void> {
    if (this.prunedFor === day) {
      return;
    }
    this.prunedFor = day;
    for (const name of expiredLogFiles(await this.fs.list(this.dir), day, LOG_KEEP_DAYS)) {
      await this.fs.remove(this.fs.join(this.dir, name));
    }
  }
}
