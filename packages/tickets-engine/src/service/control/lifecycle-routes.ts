import type { RouteContext, RouteGroup } from '../../fleet/api/route-context';
import type { ShutdownReply } from '../service-status';

/** What the lifecycle routes ask of the host. */
export interface ServiceLifecycle {
  /** Leaves; `handover` keeps the live runs for a successor (refused while a run gates). */
  shutdown(request: { readonly handover: boolean }): Promise<ShutdownReply>;
  /** Hands the live runs over to a fresh service of the same build and leaves (refused while a run gates). */
  restart(): Promise<ShutdownReply>;
  log(message: string): void;
}

/**
 * `POST /shutdown` (the owner's quit: live runs stopped first; `{handover:
 * true}` from a newer build) and `POST /restart` (req-165: the atomic
 * restart — the runner hands its runs over, the service starts its
 * successor and leaves; 409 while a run is in its gate).
 */
export class LifecycleRoutes implements RouteGroup {
  constructor(private readonly host: ServiceLifecycle) {}

  async handle(ctx: RouteContext): Promise<boolean> {
    if (ctx.method !== 'POST') {
      return false;
    }
    if (ctx.pathname === '/shutdown') {
      await this.shutdown(ctx);
      return true;
    }
    if (ctx.pathname === '/restart') {
      this.host.log('restart requested');
      const reply = await this.host.restart();
      ctx.respond(reply.ok ? 200 : 409, reply);
      return true;
    }
    return false;
  }

  private async shutdown(ctx: RouteContext): Promise<void> {
    const body = (await ctx.body().catch(() => ({}))) as { handover?: unknown };
    const handover = body.handover === true;
    this.host.log(handover ? 'a newer build asks for the handover' : 'shutdown requested');
    if (handover) {
      const reply = await this.host.shutdown({ handover: true });
      ctx.respond(reply.ok ? 200 : 409, reply);
      return;
    }
    ctx.respond(200, { ok: true });
    void this.host.shutdown({ handover: false });
  }
}
