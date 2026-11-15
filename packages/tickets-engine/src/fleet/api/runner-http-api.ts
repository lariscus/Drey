import * as crypto from 'node:crypto';
import * as http from 'node:http';
import type { RunnerExit } from '../runner/runner-exit';
import type { IdleWatch } from '../runner/runner-lifecycle';
import { routeContext, type RouteContext, type RouteGroup } from './route-context';

/** The routes a leaving runner still answers: the stop itself and the retire question. */
const WHILE_LEAVING = new Set(['/shutdown', '/retire-if-idle']);

/**
 * The runner's loopback HTTP endpoint (ADR-0075): a bearer token on every
 * request — Drey talks to it, and so can a terminal (curl). The routes live
 * in one handler class per group; this class only authenticates, counts
 * writes for the idle span (req-110: reads never count) and dispatches.
 */
export class RunnerHttpApi {
  private readonly token: Buffer;

  constructor(
    token: string,
    private readonly groups: readonly RouteGroup[],
    private readonly runner: { readonly exit: RunnerExit; readonly idle: IdleWatch },
  ) {
    this.token = Buffer.from(token, 'utf8');
  }

  server(): http.Server {
    return http.createServer((req, res) => {
      if (req.method !== 'GET') {
        this.runner.idle.noteActivity();
      }
      const ctx = routeContext(req, res);
      if (!this.authorized(req.headers.authorization ?? '')) {
        ctx.respond(401, { ok: false, error: 'unauthorized' });
        return;
      }
      void this.route(ctx);
    });
  }

  private authorized(given: string): boolean {
    const prefix = 'Bearer ';
    return given.startsWith(prefix) && given.length === prefix.length + this.token.length && crypto.timingSafeEqual(Buffer.from(given.slice(prefix.length), 'utf8'), this.token);
  }

  private async route(ctx: RouteContext): Promise<void> {
    try {
      // D-51: a runner on its way out takes no more writes — an On sent in that instant would be lost with the process.
      if (ctx.method === 'POST' && this.runner.exit.isLeaving && !WHILE_LEAVING.has(ctx.pathname)) {
        ctx.respond(503, { ok: false, error: 'the runner is leaving', code: 'leaving' });
        return;
      }
      for (const group of this.groups) {
        if (await group.handle(ctx)) {
          return;
        }
      }
      ctx.respond(404, { ok: false, error: `no such route: ${ctx.method} ${ctx.pathname}` });
    } catch (error) {
      ctx.respond(400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
