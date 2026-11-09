import type { GovernorStatus } from '../protocol';
import type { RouteContext, RouteGroup } from './route-context';

/** What the route needs of the governor. */
export interface GovernorDesk {
  status(): GovernorStatus;
}

/**
 * The resource governor (req-180): `GET /governor` answers its status —
 * heavy and light seats with their holders, the load against the reserve,
 * the quiet hours, the waiting tasks and the leased dev-server ports. The
 * same status rides the `governor` event on `GET /events`.
 */
export class GovernorRoutes implements RouteGroup {
  constructor(private readonly desk: GovernorDesk) {}

  handle(ctx: RouteContext): Promise<boolean> {
    if (ctx.method !== 'GET' || ctx.pathname !== '/governor') {
      return Promise.resolve(false);
    }
    ctx.respond(200, { ok: true, governor: this.desk.status() });
    return Promise.resolve(true);
  }
}
