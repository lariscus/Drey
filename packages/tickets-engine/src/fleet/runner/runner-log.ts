import { promises as fsp } from 'node:fs';

/**
 * The runner's log (T-0007 review finding 2: the daemon's doings were
 * invisible): every line reaches the console mirror, a ring buffer the
 * `/log` route serves, and `runner.log` — the owner's window into every
 * dispatch decision, kept under half a megabyte.
 */
export class RunnerLog {
  private readonly ring: string[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly stdout: (line: string) => void,
  ) {}

  readonly line = (message: string): void => {
    const line = `[fleet ${new Date().toISOString()}] ${message}`;
    this.stdout(line);
    this.ring.push(line);
    if (this.ring.length > 1000) {
      this.ring.splice(0, this.ring.length - 1000);
    }
    this.chain = this.chain.then(() => this.append(line)).catch(() => undefined);
  };

  /** The last `count` lines. */
  tail(count: number): string {
    return this.ring.slice(-count).join('\n');
  }

  /** Waits for the file writes behind the promise chain — a process about to leave would lose them. */
  flush(): Promise<void> {
    return this.chain;
  }

  private async append(line: string): Promise<void> {
    await fsp.appendFile(this.file, `${line}\n`, 'utf8');
    const stat = await fsp.stat(this.file).catch(() => null);
    if (stat !== null && stat.size > 512 * 1024) {
      const text = await fsp.readFile(this.file, 'utf8').catch(() => '');
      await fsp.writeFile(this.file, text.slice(-256 * 1024), 'utf8');
    }
  }
}
