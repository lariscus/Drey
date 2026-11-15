import type { Clock } from '../ports/clock';
import { ONE_ON_ONE_IDLE_MS } from '../protocol-session';
import type { LiveRun } from '../runner/live-run';
import { isLiveHeldSession } from '../runner/held-session-starter';
import type { RunBookkeeper } from '../runner/run-bookkeeper';
import type { RunSettler } from '../runner/run-settler';

export interface IdleReleaseDeps {
  readonly settler: RunSettler;
  readonly bookkeeper: RunBookkeeper;
  readonly clock: Clock;
  readonly log: (message: string) => void;
  /** How long a held 1:1 may stand without a turn; absent = {@link ONE_ON_ONE_IDLE_MS}. */
  readonly idleMs?: number;
}

/**
 * The idle release of a held session — a 1:1 or a free session (req-157's lifecycle as req-168
 * builds it, ADR-0093): a 1:1 stands held while the owner keeps talking —
 * its provider session and cache kept — and is let go once it has stood
 * this long without a turn: the worker stops, the session settles `done`,
 * its slot is free. Never in the middle of a turn, never while the worker
 * waits on the owner. The next line starts a fresh session that reads the
 * conversation back from the chat session file.
 */
export class IdleRelease {
  constructor(private readonly deps: IdleReleaseDeps) {}

  /** The span a held 1:1 may stand idle. */
  idleMs(): number {
    return this.deps.idleMs ?? ONE_ON_ONE_IDLE_MS;
  }

  /** Whether this run is a held 1:1 that has stood idle past the span. */
  due(run: LiveRun): boolean {
    if (!isLiveHeldSession(run) || run.info.state !== 'running' || run.info.turn === 'busy') {
      return false;
    }
    if (run.info.waiting !== undefined && run.info.waiting !== null) {
      return false;
    }
    const last = Math.max(run.startedAtMs, Date.parse(run.info.lastActivity) || 0);
    return this.deps.clock.now().getTime() - last >= this.idleMs();
  }

  /** Releases the run when it is due; true when it did. */
  async releaseIfDue(run: LiveRun): Promise<boolean> {
    if (!this.due(run)) {
      return false;
    }
    const minutes = Math.round(this.idleMs() / 60_000);
    run.stopNote = `released after ${minutes} min idle`;
    this.deps.log(`session ${run.info.id} (1:1 with ${run.info.persona ?? '?'}): released after ${minutes} min idle`);
    await this.deps.bookkeeper.note(run, `released after ${minutes} min idle — the next line starts a fresh session`);
    // The settle first: the stop resolves the worker's exit, and that verdict must find the run over.
    const settled = this.deps.settler.finish(run, 'done');
    const handle = run.handle;
    if (handle !== null) {
      await handle.stop().catch(() => undefined);
    }
    await settled;
    return true;
  }
}
