import type { SupervisorSet } from '../orchestrate/supervisor-set';
import type { RunnerExit } from '../runner-exit';
import { retireVerdict } from '../runner-lifecycle';
import type { RunnerLog } from '../runner-log';
import type { RouteContext, RouteGroup } from './route-context';

/** The runner's own life: health, the shutdown (graceful or a handover), retire-if-idle, the log. */
export class LifecycleRoutes implements RouteGroup {
  constructor(
    private readonly exit: RunnerExit,
    private readonly supervisors: SupervisorSet,
    private readonly log: RunnerLog,
    private readonly identity: { readonly version: number; readonly build: string },
  ) {}

  async handle(ctx: RouteContext): Promise<boolean> {
    if (ctx.method === 'GET' && ctx.pathname === '/health') {
      ctx.respond(200, { ok: true, version: this.identity.version, build: this.identity.build, live: this.supervisors.liveCount() });
      return true;
    }
    if (ctx.method === 'GET' && ctx.pathname === '/log') {
      this.tail(ctx);
      return true;
    }
    if (ctx.method === 'POST' && ctx.pathname === '/shutdown') {
      await this.shutdown(ctx);
      return true;
    }
    if (ctx.method === 'POST' && ctx.pathname === '/retire-if-idle') {
      // Drey is gone (req-110): the decision is the runner's own — a live run or an On/Paused Autopilot says no.
      const verdict = retireVerdict(this.exit.liveness());
      ctx.respond(200, { ok: true, ...verdict });
      if (verdict.exiting) {
        this.exit.leave('Drey closed and nothing is live');
      }
      return true;
    }
    return false;
  }

  /** The log's last lines: `?tail=<n>`, at most 2000, 300 by default. */
  private tail(ctx: RouteContext): void {
    const tail = Number(ctx.search.get('tail') ?? '');
    ctx.raw(200, 'text/plain; charset=utf-8', this.log.tail(Number.isFinite(tail) && tail > 0 ? Math.min(Math.trunc(tail), 2000) : 300));
  }

  /**
   * Retired for a newer build (req-51): the runs go on under the successor;
   * mid-transition runs make it wait (409, the client asks again). Otherwise
   * graceful: a worker left alive while its record goes detached is an
   * unsupervised agent on a parked ticket (T-0007 review).
   */
  private async shutdown(ctx: RouteContext): Promise<void> {
    const body = (await ctx.body().catch(() => ({}))) as { handover?: unknown };
    if (body.handover === true) {
      const blocker = this.exit.handOver();
      ctx.respond(blocker === null ? 200 : 409, blocker === null ? { ok: true } : { ok: false, error: blocker });
      return;
    }
    ctx.respond(200, { ok: true });
    this.log.line('shutdown requested — stopping live runs first, then exiting (a newer build hands over instead)');
    await this.exit.stopLiveRuns();
    setTimeout(() => this.exit.shutdown(0), 100);
  }
}
