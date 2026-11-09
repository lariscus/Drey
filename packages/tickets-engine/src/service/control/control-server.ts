/**
 * Drey Service's control port (req-164): loopback only, the engine's token
 * as the bearer on every request. It authenticates and dispatches; the
 * routes live in one group class each (the Crew runner's pattern,
 * `fleet/api/runner-http-api.ts`).
 */
import { timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import * as http from 'node:http';
import { routeContext, type RouteContext, type RouteGroup } from '../../fleet/api/route-context';

export function tokenMatches(header: string, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const given = Buffer.from(header);
  return token !== '' && given.length === expected.length && timingSafeEqual(given, expected);
}

export class ControlServer {
  private server: http.Server | null = null;

  constructor(
    private readonly token: () => string,
    private readonly groups: readonly RouteGroup[],
    private readonly onError: (message: string) => void,
  ) {}

  /** Binds a free loopback port; resolves with it. */
  async listen(): Promise<number> {
    const server = http.createServer((req, res) => {
      const ctx = routeContext(req, res);
      if (!tokenMatches(req.headers.authorization ?? '', this.token())) {
        ctx.respond(401, { ok: false, error: 'unauthorized' });
        return;
      }
      void this.route(ctx);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('the service control port did not bind');
    }
    this.server = server;
    return address.port;
  }

  close(): void {
    this.server?.close();
  }

  private async route(ctx: RouteContext): Promise<void> {
    try {
      for (const group of this.groups) {
        if (await group.handle(ctx)) {
          return;
        }
      }
      ctx.respond(404, { ok: false, error: 'not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.onError(`control: ${message}`);
      ctx.respond(500, { ok: false, error: 'internal error' });
    }
  }
}
