/**
 * The service's window processes (req-165, ADR-0092 later change
 * 2026-11-09): the tray icon lives in a small Electron process the service
 * starts while `service.trayIcon` is shown, starts again when it dies
 * (backing off), and ends with the service. The window opens in that
 * process — or, with the icon hidden, in one started for it that leaves
 * when its window closes. The window process reads the setting itself and
 * drops its icon when it is hidden; the service only stops starting it.
 */
import type { WindowChild, WindowMode } from './launch';

export type WindowSpawn = (mode: WindowMode) => WindowChild;

/** Exit code of a window process that found another one holding the single-instance lock (it handed its arguments over). */
export const HANDED_OVER_EXIT = 3;

const BACKOFF_START_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;
/** After a hand-over exit: a stale window process of an earlier service leaves within this span. */
const HANDED_OVER_RETRY_MS = 10_000;
const GIVE_UP_AFTER = 5;

export interface WindowProcessesOptions {
  readonly spawn: WindowSpawn;
  readonly log: (message: string, level?: 'info' | 'warn') => void;
  readonly now?: () => number;
}

export class WindowProcesses {
  private tray: WindowChild | null = null;
  private readonly children = new Set<WindowChild>();
  private nextAttemptAt = 0;
  private failures = 0;
  private gaveUp = false;
  private stopped = false;

  constructor(private readonly opts: WindowProcessesOptions) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  /** True while a tray process runs. */
  get trayRunning(): boolean {
    return this.tray !== null;
  }

  /** Every tick: keeps a tray process while the icon is shown. Showing it again after a give-up retries. */
  sync(shown: boolean): void {
    if (!shown) {
      this.gaveUp = false;
      this.failures = 0;
      return;
    }
    if (this.stopped || this.gaveUp || this.tray !== null || this.now() < this.nextAttemptAt) {
      return;
    }
    this.startTray();
  }

  /** Opens the window: in the tray process when one runs (it takes the arguments over), else in a process of its own. */
  open(): { readonly ok: true } | { readonly ok: false; readonly error: string } {
    if (this.stopped) {
      return { ok: false, error: 'the service is stopping' };
    }
    try {
      this.track(this.opts.spawn('open'), null);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** The service ends: every window process goes with it. */
  stopAll(): void {
    this.stopped = true;
    for (const child of [...this.children]) {
      child.kill();
    }
    this.children.clear();
    this.tray = null;
  }

  private startTray(): void {
    try {
      this.tray = this.opts.spawn('tray');
    } catch (error) {
      this.trayEnded(null, error instanceof Error ? error.message : String(error));
      return;
    }
    this.track(this.tray, (code) => this.trayEnded(code, null));
  }

  private track(child: WindowChild, onExit: ((code: number | null) => void) | null): void {
    this.children.add(child);
    child.onExit((code) => {
      this.children.delete(child);
      onExit?.(code);
    });
  }

  private trayEnded(code: number | null, error: string | null): void {
    this.tray = null;
    if (this.stopped) {
      return;
    }
    if (code === HANDED_OVER_EXIT) {
      this.nextAttemptAt = this.now() + HANDED_OVER_RETRY_MS;
      return;
    }
    if (code === 0) {
      // A clean leave: the icon was hidden and no window was open.
      this.nextAttemptAt = this.now() + BACKOFF_START_MS;
      return;
    }
    this.failures++;
    const wait = Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** (this.failures - 1));
    this.nextAttemptAt = this.now() + wait;
    const why = error ?? `exit code ${String(code)}`;
    if (this.failures >= GIVE_UP_AFTER) {
      this.gaveUp = true;
      this.opts.log(`the tray icon process ended ${this.failures} times (${why}) — not started again until the icon is switched off and on`, 'warn');
      return;
    }
    this.opts.log(`the tray icon process ended (${why}) — starting it again in ${Math.round(wait / 1000)} s`, 'warn');
  }
}
