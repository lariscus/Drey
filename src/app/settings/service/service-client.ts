import { Injectable } from '@angular/core';
import {
  SERVICE_PREF_DEFAULTS,
  SERVICE_STOPPED,
  type ServiceControlRequest,
  type ServicePrefs,
  type ServiceStatusReply,
} from '../../../../shared/service-settings';

/** The plugin that owns the service's control (the tickets plugin starts, adopts and talks to Drey Service). */
const SERVICE_PLUGIN = 'tickets';

export interface ServiceControlReply {
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * The Background service page's seam to Drey Service (req-165). The page is
 * a core Settings category; the service itself is the tickets plugin's to
 * start, adopt and call (`plugins/tickets/main/service-lifecycle.ts`), so
 * every call here is a plugin IPC method (`plugin:invoke`). With the plugin
 * off the calls fail and the page shows the service as not running with
 * the stored defaults -- nothing is guessed.
 */
@Injectable({ providedIn: 'root' })
export class ServiceClient {
  private invoke(method: string, payload?: unknown): Promise<unknown> {
    const api = window.dreyApi;
    return api?.invokePlugin === undefined
      ? Promise.reject(new Error('no-plugin-bridge'))
      : api.invokePlugin(SERVICE_PLUGIN, method, payload);
  }

  async status(): Promise<ServiceStatusReply> {
    try {
      return (await this.invoke('serviceStatus')) as ServiceStatusReply;
    } catch {
      return SERVICE_STOPPED;
    }
  }

  /** The stored preferences, or `null` while the plugin is not answering (the page draws its defaults, disabled). */
  async prefs(): Promise<ServicePrefs | null> {
    try {
      return (await this.invoke('serviceSettings')) as ServicePrefs;
    } catch {
      return null;
    }
  }

  async setPrefs(patch: Partial<ServicePrefs>): Promise<ServicePrefs | null> {
    try {
      return (await this.invoke('serviceSettingsSet', patch)) as ServicePrefs;
    } catch {
      return this.prefs();
    }
  }

  async control(request: ServiceControlRequest): Promise<ServiceControlReply> {
    try {
      return (await this.invoke('serviceControl', request)) as ServiceControlReply;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** The remote gateway follows Settings → Remote access: its Start and Stop switch `remote.enabled`. */
  async setGateway(enabled: boolean): Promise<void> {
    await this.invoke('remoteConfigure', { enabled }).catch(() => undefined);
  }

  async openLogFolder(): Promise<void> {
    await this.invoke('serviceOpenLogFolder').catch(() => undefined);
  }
}

export const DEFAULT_PREFS: ServicePrefs = SERVICE_PREF_DEFAULTS;
