/**
 * The engine's line to the Crew runner (req-164, ADR-0092): where it
 * listens, waking it when a write needs it, and the bearer-authenticated
 * requests over its loopback port. Split out of `FleetClient` with req-177
 * (the size baseline's ratchet); `FleetClient` keeps the fleet's API and
 * asks this class for the runner.
 */
import type { RunnerDescriptor } from '../fleet/protocol';

/**
 * Where the Crew runner listens, and how it is woken (req-164). Drey
 * Service's runner component implements it; a spec hands a fixed one.
 */
export interface RunnerLocator {
  /** The runner's endpoint while it is awake, null while it sleeps. Never starts it. */
  current(): Promise<RunnerDescriptor | null>;
  /** Starts the runner when it sleeps (D-51's on-demand start); a failure says why. */
  wake(): Promise<{ readonly ok: true; readonly descriptor: RunnerDescriptor } | { readonly ok: false; readonly error: string }>;
}

export type RunnerReply<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export class RunnerConnection {
  private descriptor: RunnerDescriptor | null = null;
  private spawning: Promise<boolean> | null = null;
  /** Why the last runner start failed (D-51); cleared when a runner is adopted. */
  private lastRunnerFailure: string | null = null;

  constructor(
    private readonly runner: RunnerLocator,
    private readonly log: (message: string, level?: 'info' | 'warn' | 'error') => void,
  ) {}

  base(): string {
    return `http://127.0.0.1:${this.descriptor?.port ?? 0}`;
  }

  headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.descriptor?.token ?? ''}` };
  }

  /** The runner is gone (it said it leaves): the next request looks for it again. */
  forget(): void {
    this.descriptor = null;
  }

  /** The runner's endpoint, or a wake when it sleeps (D-51). Only writes and starts may bring the runner up. */
  async ensure(): Promise<boolean> {
    if (this.descriptor === null || !(await this.alive())) {
      this.descriptor = await this.readDescriptor();
      if (this.descriptor === null || !(await this.alive())) {
        return this.wake();
      }
    }
    return true;
  }

  /** Read-only adoption: talk to a runner that is awake, never wake one. */
  async adopt(): Promise<boolean> {
    if (this.descriptor !== null && (await this.alive())) {
      return true;
    }
    this.descriptor = await this.readDescriptor();
    return this.descriptor !== null && (await this.alive());
  }

  /** The descriptor's runner when it answers `/health`; nothing else — no spawn, no handover. */
  async adoptAlive(): Promise<RunnerDescriptor | null> {
    return (await this.adopt()) ? this.descriptor : null;
  }

  /** A run start's or a message's refusal without a runner: the last start failure, else the plain fact. */
  downReason(): string {
    return this.lastRunnerFailure !== null ? `the fleet runner could not be started: ${this.lastRunnerFailure}` : 'the fleet runner is not running';
  }

  /** The Autopilot refusal's reason (`runner_down` already says "could not be started"): the bare cause. */
  failureCause(): string {
    return this.lastRunnerFailure ?? 'the fleet runner is not running';
  }

  /**
   * A write that brings the runner up when it is down (D-51). A runner that
   * answers "leaving" (req-110: it goes to sleep after an Off with nothing
   * live) is waited out and woken again, once; a request the runner died
   * under is retried the same way. Never null: a failure says why.
   */
  async postWithWake<T>(pathname: string, body: unknown): Promise<RunnerReply<T>> {
    let lastError = this.failureCause();
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!(await this.ensure())) {
        return { ok: false, error: this.failureCause() };
      }
      try {
        const res = await this.postRaw(pathname, body);
        const reply = (await res.json()) as T & { code?: unknown };
        if (res.status === 503 && reply.code === 'leaving') {
          lastError = 'the fleet runner was leaving and no new one came up';
          await this.waitGone();
          continue;
        }
        return { ok: true, value: reply };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (this.descriptor !== null && (await this.alive())) {
          return { ok: false, error: lastError };
        }
        this.descriptor = null;
      }
    }
    return { ok: false, error: lastError };
  }

  async get<T>(pathname: string): Promise<T> {
    const res = await fetch(`${this.base()}${pathname}`, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`${pathname} failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }

  async post<T>(pathname: string, body: unknown): Promise<T> {
    return (await (await this.postRaw(pathname, body)).json()) as T;
  }

  private postRaw(pathname: string, body: unknown): Promise<Response> {
    return fetch(`${this.base()}${pathname}`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /** Waits (bounded) until the current runner stops answering, then forgets it. */
  private async waitGone(): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && this.descriptor !== null && (await this.alive())) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.descriptor = null;
  }

  /** Wakes the runner component (req-164: in the service's own process, no spawn). One wake at a time. */
  private wake(): Promise<boolean> {
    this.spawning ??= this.wakeOnce().finally(() => {
      this.spawning = null;
    });
    return this.spawning;
  }

  private async wakeOnce(): Promise<boolean> {
    try {
      const woke = await this.runner.wake();
      if (woke.ok) {
        this.descriptor = woke.descriptor;
        this.log(`Crew runner awake (port ${woke.descriptor.port})`);
        this.lastRunnerFailure = null;
        return true;
      }
      this.lastRunnerFailure = woke.error;
    } catch (error) {
      this.lastRunnerFailure = error instanceof Error ? error.message : String(error);
    }
    this.log(`the fleet runner could not be started: ${this.lastRunnerFailure}`, 'warn');
    return false;
  }

  private async readDescriptor(): Promise<RunnerDescriptor | null> {
    return this.runner.current().catch(() => null);
  }

  private async alive(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base()}/health`, { headers: this.headers(), signal: AbortSignal.timeout(1_500) });
      return res.ok;
    } catch {
      return false;
    }
  }
}
