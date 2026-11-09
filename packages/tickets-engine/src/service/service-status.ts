/** What `GET /status` answers (req-164; `settings` and `logFolder` since req-165). Types only. */
import type { ServicePrefs } from '../../../../shared/service-settings';
import type { ComponentName, ComponentRecord } from './service-lock';
import type { SleepVerdict } from './sleep';

/** `service.enabled`: background (outlives Drey) or with Drey. */
export type ServiceMode = 'background' | 'with-drey';

export interface ServiceStatus {
  readonly pid: number;
  readonly build: string;
  readonly startedAt: string;
  readonly vaultPath: string;
  readonly components: Readonly<Record<ComponentName, ComponentRecord>>;
  /** What holds the service now, or that nothing does. */
  readonly sleep: SleepVerdict;
  readonly dreyClients: number;
  readonly mode: ServiceMode;
  /** Settings → Background service as the service applies it (the window draws the Load group from it). */
  readonly settings: ServicePrefs;
  /** The folder of the per-component log files. */
  readonly logFolder: string;
  /** A tray icon process runs. */
  readonly trayRunning: boolean;
}

export type ShutdownReply = { readonly ok: true } | { readonly ok: false; readonly error: string };
