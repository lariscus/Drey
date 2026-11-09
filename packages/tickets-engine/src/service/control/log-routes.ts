import type { EventChannel, RouteContext, RouteGroup } from '../../fleet/api/route-context';
import type { ServiceLog } from '../service-log';

/** A comment line every this often keeps a quiet stream open. */
export const LOG_HEARTBEAT_MS = 15_000;

/**
 * The service log over the control port: `GET /log?tail=N&component=<name>`
 * (plain text, the last lines) and `GET /log/stream` (req-165: server-sent
 * events, `event: log` with each new line as a JSON string — the window's
 * log panel follows it). Every stream ends when the service goes.
 */
export class LogRoutes implements RouteGroup {
  private readonly open = new Set<EventChannel>();

  constructor(
    private readonly log: ServiceLog,
    private readonly heartbeatMs: number = LOG_HEARTBEAT_MS,
  ) {}

  async handle(ctx: RouteContext): Promise<boolean> {
    if (ctx.method !== 'GET') {
      return false;
    }
    if (ctx.pathname === '/log') {
      const tail = Number(ctx.search.get('tail') ?? '');
      const count = Number.isFinite(tail) && tail > 0 ? Math.min(Math.trunc(tail), 2000) : 300;
      ctx.raw(200, 'text/plain; charset=utf-8', this.log.tail(count, ctx.search.get('component')).join('\n'));
      return true;
    }
    if (ctx.pathname === '/log/stream') {
      this.stream(ctx);
      return true;
    }
    return false;
  }

  private stream(ctx: RouteContext): void {
    const channel = ctx.stream();
    this.open.add(channel);
    channel.write('retry: 3000\n\n');
    const unsubscribe = this.log.subscribe((line) => channel.write(`event: log\ndata: ${JSON.stringify(line)}\n\n`));
    const beat = setInterval(() => channel.write(': ping\n\n'), this.heartbeatMs);
    beat.unref();
    channel.onClose(() => {
      clearInterval(beat);
      unsubscribe();
      this.open.delete(channel);
    });
  }

  /** The service goes: every stream ends (a server close would otherwise wait for them). */
  closeAll(): void {
    for (const channel of [...this.open]) {
      channel.end();
    }
  }
}
