import { describe, expect, it, vi } from 'vitest';
import { ServiceLog, type LogSink } from '../service-log';
import { ComponentRoutes, refusalOf, type ComponentControls } from './component-routes';
import { LifecycleRoutes, type ServiceLifecycle } from './lifecycle-routes';
import { LogRoutes } from './log-routes';
import { fakeChannel, fakeRequest } from './route-context.fake';
import { SettingsRoutes } from './settings-routes';
import { WindowRoutes } from './window-routes';

/**
 * The control port's route groups (req-164, req-165) over fakes: the
 * components (runner, gateway, the engine's restart), the log and its live
 * stream, the lifecycle (shutdown, the atomic restart), the settings and the
 * window.
 */
const NULL_SINK: LogSink = { write: () => undefined, flush: async () => undefined };

function controls(): ComponentControls & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    wakeRunner: async () => {
      calls.push('wake');
      return { ok: true };
    },
    stopRunner: async () => {
      calls.push('stop');
    },
    runnerRecord: () => ({ state: 'running', detail: '127.0.0.1:1' }),
    setGateway: async (enabled) => {
      calls.push(`gateway:${enabled}`);
      return { ok: true };
    },
    restartService: async () => {
      calls.push('restart');
      return { ok: true };
    },
  };
}

describe('POST /components/<name>/<action>', () => {
  it('the runner wakes, sleeps, and restarts as stop then wake — the answer carries its record', async () => {
    const c = controls();
    const routes = new ComponentRoutes(c);
    for (const action of ['start', 'stop', 'restart']) {
      const { ctx, answer } = fakeRequest('POST', `/components/runner/${action}`);
      expect(await routes.handle(ctx)).toBe(true);
      expect(answer).toMatchObject({ status: 200, body: { ok: true, record: { state: 'running' } } });
    }
    expect(c.calls).toEqual(['wake', 'stop', 'stop', 'wake']);
  });

  it('the gateway is switched like Settings → Remote access; its restart is off then on', async () => {
    const c = controls();
    const routes = new ComponentRoutes(c);
    for (const action of ['stop', 'start', 'restart']) {
      await routes.handle(fakeRequest('POST', `/components/gateway/${action}`).ctx);
    }
    expect(c.calls).toEqual(['gateway:false', 'gateway:true', 'gateway:false', 'gateway:true']);
  });

  it("the engine's restart is the service's restart; its stop and the MCP server refuse with the reason", async () => {
    const c = controls();
    const routes = new ComponentRoutes(c);
    await routes.handle(fakeRequest('POST', '/components/engine/restart').ctx);
    expect(c.calls).toEqual(['restart']);
    const stop = fakeRequest('POST', '/components/engine/stop');
    await routes.handle(stop.ctx);
    expect(stop.answer.status).toBe(409);
    expect(refusalOf('mcp', 'start')).toContain('runs as long as the service runs');
  });

  it('an unknown component or action is a 404; other routes pass', async () => {
    const routes = new ComponentRoutes(controls());
    const bad = fakeRequest('POST', '/components/runner/explode');
    await routes.handle(bad.ctx);
    expect(bad.answer.status).toBe(404);
    expect(await routes.handle(fakeRequest('GET', '/status').ctx)).toBe(false);
  });
});

describe('the log routes', () => {
  it('GET /log answers the tail, optionally of one component', async () => {
    const log = new ServiceLog({ sink: NULL_SINK });
    log.log('runner', 'a');
    log.log('engine', 'b');
    const routes = new LogRoutes(log);
    const all = fakeRequest('GET', '/log?tail=10');
    await routes.handle(all.ctx);
    expect(all.answer.text?.split('\n')).toHaveLength(2);
    const one = fakeRequest('GET', '/log?component=engine');
    await routes.handle(one.ctx);
    expect(one.answer.text).toContain(' b');
    expect(one.answer.text).not.toContain(' a');
  });

  it('GET /log/stream sends every new line as an event until the client goes; closeAll ends the rest', async () => {
    vi.useFakeTimers();
    const log = new ServiceLog({ sink: NULL_SINK });
    const routes = new LogRoutes(log, 1000);
    const ch = fakeChannel();
    await routes.handle(fakeRequest('GET', '/log/stream', {}, ch).ctx);
    log.log('service', 'hello');
    expect(ch.written.join('')).toMatch(/event: log\ndata: ".*service +hello"\n\n/);
    vi.advanceTimersByTime(1000);
    expect(ch.written.at(-1)).toBe(': ping\n\n');
    ch.close();
    const count = ch.written.length;
    log.log('service', 'after');
    expect(ch.written).toHaveLength(count);
    const other = fakeChannel();
    await routes.handle(fakeRequest('GET', '/log/stream', {}, other).ctx);
    routes.closeAll();
    expect(other.ended).toBe(true);
    vi.useRealTimers();
  });
});

describe('the lifecycle routes', () => {
  const lifecycle = (restart: { ok: true } | { ok: false; error: string }): ServiceLifecycle & { asked: string[] } => {
    const asked: string[] = [];
    return {
      asked,
      shutdown: async (r) => {
        asked.push(r.handover ? 'handover' : 'shutdown');
        return { ok: true };
      },
      restart: async () => {
        asked.push('restart');
        return restart;
      },
      log: () => undefined,
    };
  };

  it('POST /restart is the atomic restart; a refused handover is a 409 with the reason', async () => {
    const ok = lifecycle({ ok: true });
    const a = fakeRequest('POST', '/restart');
    await new LifecycleRoutes(ok).handle(a.ctx);
    expect(a.answer.status).toBe(200);
    const refused = fakeRequest('POST', '/restart');
    await new LifecycleRoutes(lifecycle({ ok: false, error: 'T-0001 is in its gate' })).handle(refused.ctx);
    expect(refused.answer).toMatchObject({ status: 409, body: { error: 'T-0001 is in its gate' } });
  });

  it('POST /shutdown answers at once and leaves; with handover it waits for the verdict', async () => {
    const host = lifecycle({ ok: true });
    await new LifecycleRoutes(host).handle(fakeRequest('POST', '/shutdown').ctx);
    await new LifecycleRoutes(host).handle(fakeRequest('POST', '/shutdown', { handover: true }).ctx);
    expect(host.asked).toEqual(['shutdown', 'handover']);
  });
});

describe('POST /settings', () => {
  it('writes the switches; start with Windows on also switches the service on', async () => {
    const written: Record<string, unknown> = {};
    const routes = new SettingsRoutes({
      config: () => ({ set: async (key, value) => void (written[key] = value) }),
      apply: async () => ({ mode: 'background', autostart: true }),
    });
    const r = fakeRequest('POST', '/settings', { autostart: true });
    await routes.handle(r.ctx);
    expect(written).toEqual({ 'service.autostart': true, 'service.enabled': true });
    expect(r.answer.body).toMatchObject({ ok: true, mode: 'background' });
  });

  it('refuses before the engine is up', async () => {
    const r = fakeRequest('POST', '/settings', { enabled: true });
    await new SettingsRoutes({ config: () => null, apply: async () => ({ mode: 'x', autostart: false }) }).handle(r.ctx);
    expect(r.answer.status).toBe(503);
  });
});

describe('POST /window/open', () => {
  it('opens the window, or answers why not', async () => {
    const ok = fakeRequest('POST', '/window/open');
    await new WindowRoutes({ open: () => ({ ok: true }) }).handle(ok.ctx);
    expect(ok.answer.status).toBe(200);
    const no = fakeRequest('POST', '/window/open');
    await new WindowRoutes({ open: () => ({ ok: false, error: 'stopping' }) }).handle(no.ctx);
    expect(no.answer.status).toBe(409);
  });
});
