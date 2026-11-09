import type { RouteContext, RouteGroup } from '../../fleet/api/route-context';

/** What opens the service window. */
export interface WindowOpener {
  open(): { readonly ok: true } | { readonly ok: false; readonly error: string };
}

/**
 * `POST /window/open` (req-165): Settings' *Open Drey Service…* — the
 * service starts a window process with `--open`; a running tray process
 * takes it over through Electron's single-instance lock.
 */
export class WindowRoutes implements RouteGroup {
  constructor(private readonly windows: WindowOpener) {}

  async handle(ctx: RouteContext): Promise<boolean> {
    if (ctx.method !== 'POST' || ctx.pathname !== '/window/open') {
      return false;
    }
    const reply = this.windows.open();
    ctx.respond(reply.ok ? 200 : 409, reply);
    return true;
  }
}
