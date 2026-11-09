import type { RouteContext, RouteGroup } from '../../fleet/api/route-context';

/** The config the switches are written into (the engine's). */
export interface SettingsTarget {
  config(): { set(key: string, value: unknown): Promise<void> } | null;
  /** Re-reads every setting and applies it now; answers the mode and whether start with Windows is on. */
  apply(): Promise<{ readonly mode: string; readonly autostart: boolean }>;
}

/**
 * `POST /settings {enabled?, autostart?}`: writes `service.enabled` /
 * `service.autostart` into the engine's config and applies them at once —
 * what `--autostart` and the tray's Start with Windows send.
 */
export class SettingsRoutes implements RouteGroup {
  constructor(private readonly target: SettingsTarget) {}

  async handle(ctx: RouteContext): Promise<boolean> {
    if (ctx.method !== 'POST' || ctx.pathname !== '/settings') {
      return false;
    }
    const body = (await ctx.body().catch(() => ({}))) as { enabled?: unknown; autostart?: unknown };
    const config = this.target.config();
    if (config === null) {
      ctx.respond(503, { ok: false, error: 'the engine is not up yet' });
      return true;
    }
    if (typeof body.enabled === 'boolean') {
      await config.set('service.enabled', body.enabled);
    }
    if (typeof body.autostart === 'boolean') {
      // Start with Windows belongs to the background service: on also switches it on.
      await config.set('service.autostart', body.autostart);
      if (body.autostart && body.enabled === undefined) {
        await config.set('service.enabled', true);
      }
    }
    ctx.respond(200, { ok: true, ...(await this.target.apply()) });
    return true;
  }
}
