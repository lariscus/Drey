import * as path from 'node:path';
import {
  SERVICE_PREF_KEYS,
  servicePatchOf,
  servicePrefsOf,
  type ServiceControlRequest,
  type ServicePrefs,
  type ServiceStatusReply,
} from '../../../../shared/service-settings';
import type { ServiceControl } from './service-control';

/** The plugin config the preferences live in. */
export interface ServiceConfigStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
}

export interface ServiceSettingsDeps {
  readonly config: ServiceConfigStore;
  /** Writes a key into the engine's config (the service reads its mode and idle span there). */
  readonly engineConfigSet: (key: string, value: unknown) => Promise<unknown>;
  /** Reads a key of the engine's config: the tray may have changed `service.enabled` / `service.autostart` there (req-165). */
  readonly engineConfigGet?: (key: string) => Promise<unknown>;
  readonly control: ServiceControl;
  /** Starts (or adopts) the service and re-points Drey's engine client at it. */
  readonly start: () => Promise<void>;
  /** Opens a folder in the OS file manager. */
  readonly openFolder: (dir: string) => Promise<void>;
  readonly home: () => string;
  readonly log: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

/** The keys the service itself writes (the tray's Start with Windows, `--autostart`): the engine's value wins. */
const SERVICE_OWNED: readonly (keyof ServicePrefs)[] = ['enabled', 'autostart'];

/** `{ target, action }` from the page, or null when it is not one of the calls that exist. */
export function parseControlRequest(raw: unknown): ServiceControlRequest | null {
  const p = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const { target, action } = p;
  if (target === 'window') {
    return action === 'open' ? { target, action } : null;
  }
  return (target === 'service' || target === 'runner') && (action === 'restart' || action === 'stop' || action === 'start')
    ? { target, action }
    : null;
}

/**
 * The calls Settings → Background service makes (req-165, board 8c): the
 * stored preferences, the service's status, and the controls that exist
 * on the service's side. Registered by the plugin as plugin IPC methods.
 */
export class ServiceSettingsHandlers {
  constructor(private readonly deps: ServiceSettingsDeps) {}

  async prefs(): Promise<ServicePrefs> {
    const stored = new Map<string, unknown>();
    for (const key of Object.values(SERVICE_PREF_KEYS)) {
      stored.set(key, await this.deps.config.get<unknown>(key));
    }
    for (const name of SERVICE_OWNED) {
      const key = SERVICE_PREF_KEYS[name];
      const engine = await this.deps.engineConfigGet?.(key).catch(() => undefined);
      if (typeof engine === 'boolean' && engine !== stored.get(key)) {
        stored.set(key, engine);
        await this.deps.config.set(key, engine);
      }
    }
    return servicePrefsOf((key) => stored.get(key));
  }

  /** Stores a validated patch (plugin config, then the engine's), answers the stored preferences. */
  async setPrefs(raw: unknown): Promise<ServicePrefs> {
    const patch = servicePatchOf(raw);
    for (const [name, value] of Object.entries(patch)) {
      const key = SERVICE_PREF_KEYS[name as keyof ServicePrefs];
      await this.deps.config.set(key, value);
      await this.deps.engineConfigSet(key, value).catch((error: unknown) => this.deps.log(`service setting ${key} did not reach the engine: ${String(error)}`, 'warn'));
    }
    return this.prefs();
  }

  status(): Promise<ServiceStatusReply> {
    return this.deps.control.status();
  }

  /** The service's Open / Restart / Stop / Start, the Crew runner's; what the control API offers. */
  async control(raw: unknown): Promise<{ ok: boolean; error?: string }> {
    const request = parseControlRequest(raw);
    if (request === null) {
      return { ok: false, error: 'unknown service control request' };
    }
    try {
      if (request.target === 'window') {
        return await this.deps.control.openWindow();
      }
      if (request.target === 'runner') {
        return await this.runner(request.action);
      }
      return await this.service(request.action);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Restart is the service's own atomic restart (req-165); Drey then adopts the successor and re-binds. */
  private async service(action: 'restart' | 'stop' | 'start'): Promise<{ ok: boolean; error?: string }> {
    if (action === 'restart') {
      const restarted = await this.deps.control.restart();
      if (!restarted.ok) {
        return restarted;
      }
    } else if (action === 'stop' && !(await this.deps.control.shutdown())) {
      return { ok: false, error: 'the service did not stop in time' };
    }
    if (action !== 'stop') {
      await this.deps.start();
    }
    return { ok: true };
  }

  private async runner(action: 'restart' | 'stop' | 'start'): Promise<{ ok: boolean; error?: string }> {
    if (action !== 'start') {
      const stopped = await this.deps.control.runner('stop');
      if (!stopped.ok || action === 'stop') {
        return stopped;
      }
    }
    return this.deps.control.runner('start');
  }

  /** The folder of the per-component log files (req-165). */
  async openLogFolder(): Promise<void> {
    await this.deps.openFolder(path.join(this.deps.home(), 'logs'));
  }
}
