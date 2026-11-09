/**
 * Where the service and its components listen, read from `service.lock`
 * (req-164) every time it is asked — a restart moves every port. The
 * tokens stay in the window's main process; the renderer never sees them.
 */
import * as path from 'node:path';

export interface Endpoint {
  readonly port: number;
  readonly token: string;
}

export interface ServiceEndpointSet {
  readonly pid: number;
  readonly control: Endpoint;
  /** The engine's invoke channel (its token is the control token). */
  readonly engine: Endpoint | null;
  /** The Crew runner while it is awake. */
  readonly runner: Endpoint | null;
}

interface LockShape {
  readonly pid?: unknown;
  readonly port?: unknown;
  readonly token?: unknown;
  readonly components?: Record<string, { readonly state?: unknown; readonly port?: unknown; readonly token?: unknown } | undefined>;
}

const isPort = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

/** The endpoints of a parsed lock; null for anything that is not one. */
export function endpointsOfLock(raw: unknown): ServiceEndpointSet | null {
  const lock = (typeof raw === 'object' && raw !== null ? raw : {}) as LockShape;
  if (!isPort(lock.port) || typeof lock.token !== 'string' || typeof lock.pid !== 'number') {
    return null;
  }
  const engine = lock.components?.['engine'];
  const runner = lock.components?.['runner'];
  return {
    pid: lock.pid,
    control: { port: lock.port, token: lock.token },
    engine: engine?.state === 'running' && isPort(engine.port) ? { port: engine.port, token: lock.token } : null,
    runner: runner?.state === 'running' && isPort(runner.port) && typeof runner.token === 'string' ? { port: runner.port, token: runner.token } : null,
  };
}

export class ServiceEndpoints {
  constructor(
    private readonly home: string,
    private readonly readText: (file: string) => Promise<string>,
  ) {}

  /** The lock's endpoints now; null while no service holds the home. */
  async read(): Promise<ServiceEndpointSet | null> {
    try {
      return endpointsOfLock(JSON.parse(await this.readText(path.join(this.home, 'service.lock'))) as unknown);
    } catch {
      return null;
    }
  }
}
