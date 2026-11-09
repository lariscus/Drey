import type { RouteContext, RouteGroup } from '../../fleet/api/route-context';
import { COMPONENT_NAMES, type ComponentName, type ComponentRecord } from '../service-lock';

type Reply = { readonly ok: true } | { readonly ok: false; readonly error: string };

/** What the component routes drive. */
export interface ComponentControls {
  wakeRunner(): Promise<Reply>;
  stopRunner(): Promise<void>;
  runnerRecord(): ComponentRecord;
  /** Switches the remote gateway (Settings → Remote access's `enabled`, persisted). */
  setGateway(enabled: boolean): Promise<Reply>;
  /** The atomic service restart (the engine's restart). */
  restartService(): Promise<Reply>;
}

const ACTIONS = ['start', 'stop', 'restart'] as const;
type Action = (typeof ACTIONS)[number];

/** Why a component refuses an action; null = it takes it. */
export function refusalOf(name: ComponentName, action: Action): string | null {
  if (name === 'mcp') {
    return 'the vault MCP runs as long as the service runs — live workers hold its address';
  }
  if (name === 'engine' && action !== 'restart') {
    return 'the engine runs as long as the service runs — restart it, or quit the service';
  }
  return null;
}

/**
 * `POST /components/<name>/<start|stop|restart>` (req-164, req-165): the
 * Crew runner wakes, sleeps (its live runs stopped first) or both; the
 * remote gateway is switched like Settings → Remote access; the engine's
 * restart is the service's atomic restart; the vault MCP (req-167) runs
 * with the service and refuses with the reason.
 */
export class ComponentRoutes implements RouteGroup {
  constructor(private readonly controls: ComponentControls) {}

  async handle(ctx: RouteContext): Promise<boolean> {
    if (ctx.method !== 'POST' || ctx.parts[0] !== 'components' || ctx.parts.length !== 3) {
      return false;
    }
    const name = ctx.parts[1] as ComponentName;
    const action = ctx.parts[2] as Action;
    if (!COMPONENT_NAMES.includes(name) || !ACTIONS.includes(action)) {
      ctx.respond(404, { ok: false, error: 'not found' });
      return true;
    }
    const refusal = refusalOf(name, action);
    if (refusal !== null) {
      ctx.respond(409, { ok: false, error: refusal });
      return true;
    }
    const reply = await this.act(name, action);
    ctx.respond(reply.ok ? 200 : 409, name === 'runner' && reply.ok ? { ...reply, record: this.controls.runnerRecord() } : reply);
    return true;
  }

  private async act(name: ComponentName, action: Action): Promise<Reply> {
    if (name === 'engine') {
      return this.controls.restartService();
    }
    if (name === 'gateway') {
      if (action === 'restart') {
        await this.controls.setGateway(false);
      }
      return this.controls.setGateway(action !== 'stop');
    }
    if (action !== 'start') {
      await this.controls.stopRunner();
      if (action === 'stop') {
        return { ok: true };
      }
    }
    return this.controls.wakeRunner();
  }
}
