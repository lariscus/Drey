import type { RunnerProcess, SpawnFn } from '../ports/process-spawner';
import { LineBuffer } from './line-buffer';
import { OPENCODE_API, opencodeCapConfig } from './opencode-api';
import { emitOf, type OpencodeContext } from './opencode-state';

/** How long `opencode serve` may take to print its password, and then to answer `/api/info`. */
const PASSWORD_MS = 60_000;
const READY_MS = 30_000;

/**
 * The worker's own `opencode serve` on a loopback port: the inline config
 * that caps the model's window (req-80), the per-boot credential it prints
 * on stdout (`server password <token>`), and `GET /api/info` — the ping the
 * official client's health check uses — as the ready signal.
 */
export class OpencodeServer {
  private proc: RunnerProcess | null = null;

  constructor(
    private readonly ctx: OpencodeContext,
    private readonly spawnFn: SpawnFn,
  ) {}

  get pid(): number | null {
    return this.proc?.pid ?? null;
  }

  get started(): boolean {
    return this.proc !== null;
  }

  /** Spawns the server and returns the password it printed; the exit is reported to `onExit`. */
  async spawn(port: number, onExit: (code: number | null) => void): Promise<string> {
    const { start } = this.ctx;
    const capConfig = opencodeCapConfig(start.model, start.contextCap ?? 0);
    const proc = this.spawnFn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
      cwd: start.cwd,
      ...(capConfig !== null ? { env: { OPENCODE_CONFIG_CONTENT: capConfig } } : {}),
    });
    this.proc = proc;
    if (capConfig !== null) {
      emitOf(this.ctx)({ kind: 'note', detail: 'runner', text: `context cap: ${Math.floor(start.contextCap!)} tokens — OpenCode compacts the session there` });
    }
    proc.onExit(onExit);
    return this.password(proc);
  }

  /** Waits until the server answers; false when the worker ended meanwhile (the caller ends it). */
  async ready(): Promise<boolean> {
    const deadline = Date.now() + READY_MS;
    for (;;) {
      if (!this.ctx.state.alive) {
        return false;
      }
      const res = await this.ctx.client.get(OPENCODE_API.info).catch(() => null);
      if (res?.ok === true) {
        return this.ctx.state.alive;
      }
      if (Date.now() > deadline) {
        throw new Error('opencode serve did not become ready in time');
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  async kill(): Promise<void> {
    await this.proc?.killTree();
  }

  private password(proc: RunnerProcess): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const lines = new LineBuffer();
      let seen = false;
      const deadline = Date.now() + PASSWORD_MS;
      const tick = setInterval(() => {
        if (seen) {
          clearInterval(tick);
        } else if (!this.ctx.state.alive) {
          clearInterval(tick);
          reject(new Error('opencode serve exited before printing the server password'));
        } else if (Date.now() > deadline) {
          clearInterval(tick);
          reject(new Error('opencode serve never printed the server password'));
        }
      }, 400);
      proc.onStdout((chunk) => {
        const match = seen ? null : lines.feed(chunk).map((line) => /^server password (\S+)\s*$/.exec(line)).find((m) => m !== null);
        if (match !== null && match !== undefined) {
          seen = true;
          clearInterval(tick);
          resolve(match[1]!);
        }
      });
    });
  }
}
