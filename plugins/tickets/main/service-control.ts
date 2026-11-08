import { homedir } from 'node:os';
import * as path from 'node:path';
import { readServiceLock, serviceAlive, type ServiceLock } from '../../../packages/tickets-engine/src/service/service-lock';
import type { ServiceComponentState, ServiceStatusReply } from '../../../shared/service-settings';
import { SERVICE_STOPPED } from '../../../shared/service-settings';

/** The service home, `~/.drey-engine` (ADR-0092, ruling Q4). */
export const serviceHomeOf = (): string => path.join(homedir(), '.drey-engine');

/** What the control reads about the remote gateway (the engine's `remoteStatus`). */
export interface GatewayProbe {
  readonly config: { readonly enabled: boolean };
  readonly listening: string | null;
  readonly devices: readonly unknown[];
  readonly error: string | null;
}

export interface ServiceControlDeps {
  readonly home: () => string;
  /** The runs a quit would end. */
  readonly liveRuns: () => Promise<number>;
  readonly gateway: () => Promise<GatewayProbe>;
}

const COMPONENT_STATES: ReadonlySet<string> = new Set(['starting', 'running', 'sleeping', 'stopped', 'failed', 'external']);

function stateOf(lock: ServiceLock, name: 'engine' | 'runner'): ServiceComponentState {
  const state = lock.components[name]?.state;
  return COMPONENT_STATES.has(state) ? state : 'stopped';
}

/**
 * Drey's side of the service's loopback control API (ADR-0092): the status
 * the Settings page draws, and the calls that exist — `POST /shutdown` for
 * the service, `POST /components/runner/start|stop` for the Crew runner.
 * The lock's token authenticates both; nothing here starts a process
 * (`ensureService` does, the plugin calls it for Start and Restart).
 */
export class ServiceControl {
  constructor(private readonly deps: ServiceControlDeps) {}

  /** The live service's lock, or null. */
  async lock(): Promise<ServiceLock | null> {
    const lock = await readServiceLock(this.deps.home());
    return lock !== null && (await serviceAlive(lock)) ? lock : null;
  }

  async status(): Promise<ServiceStatusReply> {
    const lock = await this.lock();
    if (lock === null) {
      return { ...SERVICE_STOPPED, home: this.deps.home() };
    }
    const [liveRuns, remote] = await Promise.all([
      this.deps.liveRuns().catch(() => 0),
      this.deps.gateway().catch(() => null),
    ]);
    return {
      running: true,
      home: this.deps.home(),
      startedAt: lock.startedAt,
      liveRuns,
      gateway: {
        enabled: remote?.config.enabled === true,
        listening: remote?.listening != null,
        devices: remote?.devices.length ?? 0,
        failed: remote?.config.enabled === true && remote.listening == null && remote.error != null,
      },
      components: { engine: stateOf(lock, 'engine'), runner: stateOf(lock, 'runner') },
    };
  }

  /** Asks the running service to leave (live runs stop first); resolves once it is gone. */
  async shutdown(): Promise<boolean> {
    const lock = await this.lock();
    if (lock === null) {
      return true;
    }
    await this.post(lock, '/shutdown', {});
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (!(await serviceAlive(lock, 500))) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return false;
  }

  /** `start` wakes the Crew runner, `stop` stops it and its live runs. */
  async runner(action: 'start' | 'stop'): Promise<{ ok: boolean; error?: string }> {
    const lock = await this.lock();
    if (lock === null) {
      return { ok: false, error: 'the service is not running' };
    }
    const reply = await this.post(lock, `/components/runner/${action}`, {});
    return reply.ok ? { ok: true } : { ok: false, error: reply.error };
  }

  private async post(lock: ServiceLock, route: string, body: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const res = await fetch(`http://127.0.0.1:${lock.port}${route}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${lock.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: unknown };
      return res.ok ? { ok: true } : { ok: false, error: typeof json.error === 'string' ? json.error : `the service answered ${res.status}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
