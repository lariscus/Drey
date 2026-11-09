/**
 * Whether the service stays (req-164, the owner's Q3 ruling): in the
 * background mode it leaves after the idle span with nothing holding it
 * ({@link ServiceIdleWatch}); with Drey it follows Drey — out once no Drey
 * has held the event stream for the grace, or a Drey that never came for
 * the first-Drey wait. The span applies live (`service.idleMinutes`).
 */
import type { ServiceMode } from './service-status';
import { ServiceIdleWatch, type ServiceLiveness } from './sleep';

/** With the service off: how long after the last Drey left the service follows it (longer than a reconnect). */
export const WITH_DREY_GRACE_MS = 10_000;
/** With the service off: how long a service started for a Drey waits for its first Drey before it gives up. */
export const FIRST_DREY_WAIT_MS = 120_000;

export interface ServiceStayOptions {
  readonly idleMs: number;
  readonly now?: () => number;
  readonly withDreyGraceMs?: number;
  readonly firstDreyWaitMs?: number;
}

export class ServiceStay {
  private idle: ServiceIdleWatch;
  private idleMs: number;
  private sawDrey = false;
  private dreyGoneAt: number | null = null;
  private readonly bootAt: number;

  constructor(private readonly opts: ServiceStayOptions) {
    this.idleMs = opts.idleMs;
    this.idle = new ServiceIdleWatch(opts.idleMs, opts.now);
    this.bootAt = this.now();
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  /** A new idle span (Settings): the clock keeps running, measured against the new span. */
  setIdleMs(idleMs: number): void {
    if (idleMs === this.idleMs) {
      return;
    }
    this.idleMs = idleMs;
    this.idle = this.idle.withSpan(idleMs);
  }

  get idleSpanMs(): number {
    return this.idleMs;
  }

  /** Why the service leaves now, or null while it stays. */
  leaveReason(mode: ServiceMode, state: ServiceLiveness): string | null {
    if (mode === 'with-drey') {
      // Keeps the background clock fresh for a switch to background later.
      this.idle.expired({ ...state, dreyClients: 1 });
      return this.dreyLeft(state) ? 'the background service is off and Drey has gone — stopping the live runs and leaving' : null;
    }
    this.sawDrey ||= state.dreyClients > 0;
    return this.idle.expired(state)
      ? `nothing has held the service for ${Math.round(this.idleMs / 1000)}s (no Drey, the runner asleep, no paired device) — leaving`
      : null;
  }

  private dreyLeft(state: ServiceLiveness): boolean {
    const now = this.now();
    if (state.dreyClients > 0) {
      this.sawDrey = true;
      this.dreyGoneAt = null;
      return false;
    }
    if (!this.sawDrey) {
      return now - this.bootAt >= (this.opts.firstDreyWaitMs ?? FIRST_DREY_WAIT_MS);
    }
    this.dreyGoneAt ??= now;
    return now - this.dreyGoneAt >= (this.opts.withDreyGraceMs ?? WITH_DREY_GRACE_MS);
  }
}
