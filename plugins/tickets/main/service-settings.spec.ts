import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ServiceControl } from './service-control';
import { ServiceSettingsHandlers, parseControlRequest } from './service-settings';

/**
 * Settings → Background service's calls (req-165): preferences stored in
 * the plugin config and the engine's, the control requests that exist.
 */
function harness() {
  const config = new Map<string, unknown>();
  const engine = new Map<string, unknown>();
  const control = {
    shutdown: vi.fn(async () => true),
    restart: vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string }),
    openWindow: vi.fn(async () => ({ ok: true })),
    runner: vi.fn(async (_action: 'start' | 'stop') => ({ ok: true })),
    status: vi.fn(),
  };
  const start = vi.fn(async () => undefined);
  const openFolder = vi.fn(async (_dir: string) => undefined);
  const handlers = new ServiceSettingsHandlers({
    config: {
      get: async <T,>(key: string) => config.get(key) as T | undefined,
      set: async (key, value) => void config.set(key, value),
    },
    engineConfigSet: async (key, value) => void engine.set(key, value),
    engineConfigGet: async (key) => engine.get(key),
    control: control as unknown as ServiceControl,
    start,
    openFolder,
    home: () => 'C:\\home\\.drey-engine',
    log: () => undefined,
  });
  return { handlers, config, engine, control, start, openFolder };
}

describe('the stored preferences', () => {
  it('writes a valid change to the plugin config and the engine, under the service.* keys', async () => {
    const { handlers, config, engine } = harness();
    const stored = await handlers.setPrefs({ enabled: true, idleMinutes: 30 });
    expect(config.get('service.enabled')).toBe(true);
    expect(engine.get('service.idleMinutes')).toBe(30);
    expect(stored.enabled).toBe(true);
    expect(stored.idleMinutes).toBe(30);
  });

  it('refuses an invalid value and keeps the stored one', async () => {
    const { handlers, config } = harness();
    await handlers.setPrefs({ idleMinutes: 20 });
    const stored = await handlers.setPrefs({ idleMinutes: -4, heavySeats: 'many' });
    expect(config.get('service.idleMinutes')).toBe(20);
    expect(stored.idleMinutes).toBe(20);
    expect(config.has('service.load.heavySeats')).toBe(false);
  });

  it('switching the service off also stores start with Windows as off', async () => {
    const { handlers, engine } = harness();
    await handlers.setPrefs({ enabled: true, autostart: true });
    await handlers.setPrefs({ enabled: false });
    expect(engine.get('service.autostart')).toBe(false);
    expect((await handlers.prefs()).autostart).toBe(false);
  });
});

describe('parseControlRequest', () => {
  it('accepts the calls that exist and nothing else', () => {
    expect(parseControlRequest({ target: 'runner', action: 'stop' })).toEqual({ target: 'runner', action: 'stop' });
    expect(parseControlRequest({ target: 'service', action: 'restart' })).toEqual({ target: 'service', action: 'restart' });
    expect(parseControlRequest({ target: 'engine', action: 'stop' })).toBeNull();
    expect(parseControlRequest({ target: 'runner', action: 'kill' })).toBeNull();
    expect(parseControlRequest(null)).toBeNull();
  });
});

describe('the control calls', () => {
  it('Stop of the service asks it to leave and starts nothing', async () => {
    const { handlers, control, start } = harness();
    expect(await handlers.control({ target: 'service', action: 'stop' })).toEqual({ ok: true });
    expect(control.shutdown).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
  });

  it("Restart of the service is the service's atomic restart, then Drey adopts the successor", async () => {
    const { handlers, control, start } = harness();
    await handlers.control({ target: 'service', action: 'restart' });
    expect(control.shutdown).not.toHaveBeenCalled();
    expect(control.restart.mock.invocationCallOrder[0]).toBeLessThan(start.mock.invocationCallOrder[0]);
  });

  it('Open Drey Service… asks the service to open its window', async () => {
    const { handlers, control } = harness();
    expect(await handlers.control({ target: 'window', action: 'open' })).toEqual({ ok: true });
    expect(control.openWindow).toHaveBeenCalledOnce();
    expect(parseControlRequest({ target: 'window', action: 'stop' })).toBeNull();
  });

  it('the tray changed start with Windows in the engine: the page reads the engine and stores it', async () => {
    const { handlers, config, engine } = harness();
    config.set('service.enabled', false);
    engine.set('service.enabled', true);
    engine.set('service.autostart', true);
    expect(await handlers.prefs()).toMatchObject({ enabled: true, autostart: true });
    expect(config.get('service.autostart')).toBe(true);
  });

  it('Start of the service stops nothing', async () => {
    const { handlers, control, start } = harness();
    await handlers.control({ target: 'service', action: 'start' });
    expect(control.shutdown).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledOnce();
  });

  it('a restart the service refuses (a run in its gate) starts nothing', async () => {
    const { handlers, control, start } = harness();
    control.restart.mockResolvedValueOnce({ ok: false, error: 'T-0001 is in its gate' });
    const reply = await handlers.control({ target: 'service', action: 'restart' });
    expect(reply.ok).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it('Restart of the Crew runner is its stop, then its start; Stop and Start are one call each', async () => {
    const { handlers, control } = harness();
    await handlers.control({ target: 'runner', action: 'restart' });
    expect(control.runner.mock.calls.map((c) => c[0])).toEqual(['stop', 'start']);
    control.runner.mockClear();
    await handlers.control({ target: 'runner', action: 'stop' });
    await handlers.control({ target: 'runner', action: 'start' });
    expect(control.runner.mock.calls.map((c) => c[0])).toEqual(['stop', 'start']);
  });

  it('a runner that refuses to stop is not started on top', async () => {
    const { handlers, control } = harness();
    control.runner.mockResolvedValueOnce({ ok: false });
    await handlers.control({ target: 'runner', action: 'restart' });
    expect(control.runner).toHaveBeenCalledTimes(1);
  });

  it('answers an unknown request with an error', async () => {
    const { handlers } = harness();
    expect((await handlers.control({ target: 'engine', action: 'stop' })).ok).toBe(false);
  });

  it('opens the folder of the per-component log files', async () => {
    const { handlers, openFolder } = harness();
    await handlers.openLogFolder();
    expect(openFolder).toHaveBeenCalledWith(path.join('C:\\home\\.drey-engine', 'logs'));
  });
});
