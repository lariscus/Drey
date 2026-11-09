import type { RouteContext, RouteGroup } from '../../fleet/api/route-context';
import type { ServiceStatus } from '../service-status';

/** What the status routes read. */
export interface StatusSource {
  readonly build: string;
  status(): Promise<ServiceStatus>;
}

/** `GET /health` (`{ok, pid, build}`) and `GET /status` (the components, the mode, the sleep verdict, the settings). */
export class StatusRoutes implements RouteGroup {
  constructor(private readonly source: StatusSource) {}

  async handle(ctx: RouteContext): Promise<boolean> {
    if (ctx.method !== 'GET') {
      return false;
    }
    if (ctx.pathname === '/health') {
      ctx.respond(200, { ok: true, pid: process.pid, build: this.source.build });
      return true;
    }
    if (ctx.pathname === '/status') {
      ctx.respond(200, { ok: true, ...(await this.source.status()) });
      return true;
    }
    return false;
  }
}
