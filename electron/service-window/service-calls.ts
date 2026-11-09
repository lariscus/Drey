/**
 * Every call the service window makes (req-165/166), by name: the service's
 * control port, the Crew runner's API and the engine's invoke channel,
 * each reached through the endpoints of `service.lock` as it stands now.
 * The window owns no state — this class only asks.
 */
import type { ActionReply, ComponentAction, ComponentId, RunAction } from '../../shared/service-window/contract';
import { i18n } from '../../shared/i18n';
import type { JsonHttp } from './json-http';
import type { Endpoint, ServiceEndpoints } from './service-endpoints';

const NO_SERVICE = (): ActionReply => ({ ok: false, error: i18n.t('service_tray.error.not_running') });
const RUNNER_ASLEEP = (): ActionReply => ({ ok: false, error: i18n.t('service_tray.error.runner_asleep') });

const RUN_ROUTES: Readonly<Record<RunAction, string>> = { send: '/send', interrupt: '/interrupt', resume: '/resume', stop: '/stop' };

export class ServiceCalls {
  constructor(
    private readonly endpoints: ServiceEndpoints,
    private readonly http: JsonHttp,
  ) {}

  private async control(): Promise<Endpoint | null> {
    return (await this.endpoints.read())?.control ?? null;
  }

  private async runner(): Promise<Endpoint | null> {
    return (await this.endpoints.read())?.runner ?? null;
  }

  async status(): Promise<Record<string, unknown> | null> {
    const ep = await this.control();
    return ep === null ? null : this.http.get<Record<string, unknown>>(ep, '/status');
  }

  async logTail(count = 500): Promise<string> {
    const ep = await this.control();
    return ep === null ? '' : ((await this.http.text(ep, `/log?tail=${count}`)) ?? '');
  }

  async component(id: Exclude<ComponentId, 'model'>, action: ComponentAction): Promise<ActionReply> {
    const ep = await this.control();
    return ep === null ? NO_SERVICE() : this.http.post(ep, `/components/${id}/${action}`);
  }

  async shutdown(): Promise<ActionReply> {
    const ep = await this.control();
    return ep === null ? NO_SERVICE() : this.http.post(ep, '/shutdown');
  }

  async setAutostart(on: boolean): Promise<ActionReply> {
    const ep = await this.control();
    return ep === null ? NO_SERVICE() : this.http.post(ep, '/settings', { autostart: on });
  }

  /** The runner's runs; empty while it sleeps. */
  async runs(): Promise<readonly Record<string, unknown>[]> {
    const ep = await this.runner();
    return ep === null ? [] : ((await this.http.get<{ runs?: readonly Record<string, unknown>[] }>(ep, '/status'))?.runs ?? []);
  }

  async stream(runId: string): Promise<string> {
    const ep = await this.runner();
    return ep === null ? '' : ((await this.http.text(ep, `/stream/${encodeURIComponent(runId)}`)) ?? '');
  }

  async instruction(runId: string): Promise<string | null> {
    const ep = await this.runner();
    return ep === null ? null : ((await this.http.get<{ instruction?: string }>(ep, `/instruction/${encodeURIComponent(runId)}`))?.instruction ?? null);
  }

  async attachCommand(runId: string): Promise<string | null> {
    const ep = await this.runner();
    return ep === null ? null : ((await this.http.get<{ command?: string | null }>(ep, `/attach/${encodeURIComponent(runId)}`))?.command ?? null);
  }

  /** The steer ladder at raw level (ADR-0075): the runner's own routes, which log to the run's stream and the ticket. */
  async runAction(runId: string, action: RunAction, text?: string): Promise<ActionReply> {
    const ep = await this.runner();
    if (ep === null) {
      return RUNNER_ASLEEP();
    }
    const reply = await this.http.post(ep, RUN_ROUTES[action], { runId, ...(text === undefined ? {} : { text }), ...(action === 'stop' ? { reason: i18n.t('service_tray.stop_reason') } : {}) });
    return reply.ok ? { ok: true } : reply;
  }

  async slots(): Promise<readonly Record<string, unknown>[] | null> {
    const ep = await this.runner();
    return ep === null ? null : ((await this.http.get<{ slots?: readonly Record<string, unknown>[] }>(ep, '/slots'))?.slots ?? null);
  }

  /** The resource governor's status (req-180); null while the runner sleeps. */
  async governor(): Promise<Record<string, unknown> | null> {
    const ep = await this.runner();
    return ep === null ? null : ((await this.http.get<{ governor?: Record<string, unknown> }>(ep, '/governor'))?.governor ?? null);
  }

  async models(): Promise<Record<string, unknown> | null> {
    const ep = await this.runner();
    return ep === null ? null : this.http.get<Record<string, unknown>>(ep, '/models');
  }

  /** The Autopilot's state; `off` while the runner sleeps (every wake starts Off, ADR-0077). */
  async autopilot(): Promise<'on' | 'paused' | 'off'> {
    const ep = await this.runner();
    const chain = ep === null ? null : await this.http.get<{ autopilot?: { state?: unknown } }>(ep, '/chain');
    const state = chain?.autopilot?.state;
    return state === 'on' || state === 'paused' ? state : 'off';
  }

  /** Through the engine, as Drey and the phones switch it (it wakes the runner). */
  async setAutopilot(state: 'on' | 'paused' | 'off'): Promise<ActionReply> {
    const engine = (await this.endpoints.read())?.engine ?? null;
    if (engine === null) {
      return NO_SERVICE();
    }
    const reply = await this.http.post(engine, '/api/invoke', { method: 'chainAutopilot', payload: { state } });
    const value = (reply.ok ? (reply.json as { value?: { ok?: unknown; error?: unknown } }).value : null) ?? null;
    if (value !== null && value.ok === false) {
      return { ok: false, error: typeof value.error === 'string' ? value.error : 'refused' };
    }
    return reply.ok ? { ok: true } : reply;
  }

  /** Stop all running steps (the Notaus). */
  async stopAll(): Promise<ActionReply> {
    const ep = await this.runner();
    return ep === null ? { ok: true } : this.http.post(ep, '/chain/abort');
  }
}
