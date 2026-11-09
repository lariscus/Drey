import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import type { McpStatus } from '../../../../shared/ipc-api';
import {
  HEAVY_SEATS_MAX,
  IDLE_MINUTES_MAX,
  RESERVE_MAX,
  SERVICE_PREF_DEFAULTS,
  SERVICE_STOPPED,
  parseQuietHours,
  wholeNumberIn,
  type ServiceAction,
  type StatusAction,
  type ServiceControlRequest,
  type ServiceLogLevel,
  type ServicePrefs,
  type ServiceStatusReply,
} from '../../../../shared/service-settings';
import { I18nPipe, I18nService } from '../../i18n';
import { SettingsService } from '../../services/settings.service';
import { SettingsPane } from '../settings-pane/settings-pane';
import { ServiceClient } from './service-client';
import {
  LOG_LEVEL_CHOICES,
  LOG_LEVEL_KEYS,
  SERVICE_ACTION_KEYS,
  componentRowsOf,
  statusActionsOf,
  statusLineOf,
  type ComponentRow,
} from './service-model';

/** How often the page re-reads the service while it is open. */
const REFRESH_MS = 3000;

/** The preferences that are a whole number in a range: key, lowest, highest. */
const NUMBER_FIELDS = {
  idleMinutes: [1, IDLE_MINUTES_MAX],
  heavySeats: [1, HEAVY_SEATS_MAX],
  reserve: [0, RESERVE_MAX],
} as const;

type NumberField = keyof typeof NUMBER_FIELDS;

/**
 * Settings → Background service (board 8c, req-165): the status of Drey
 * Service with its controls, the two switches, the idle span, the taskbar
 * icon, the components, the load and the logs. A core category over the
 * tickets plugin's service calls (`ServiceClient`); every change applies as
 * it is made, like every Settings page. Words come from the catalog
 * (`settings.service.*`).
 */
@Component({
  selector: 'app-settings-background-service',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SettingsPane, I18nPipe],
  templateUrl: './settings-background-service.html',
  styleUrl: './settings-background-service.css',
})
export class SettingsBackgroundService {
  private readonly client = inject(ServiceClient);
  private readonly settings = inject(SettingsService);
  protected readonly i18n = inject(I18nService);

  protected readonly status = signal<ServiceStatusReply>(SERVICE_STOPPED);
  /** `null` until the plugin answers; the page then draws the defaults, disabled. */
  private readonly stored = signal<ServicePrefs | null>(null);
  private readonly mcp = signal<McpStatus | null>(null);
  /** The control in flight (`status:restart`, `runner:stop`, …): its buttons wait. */
  protected readonly busy = signal<string | null>(null);
  protected readonly levelMenu = signal(false);
  /** Fields whose last input was refused, marked until the next valid one. */
  protected readonly invalid = signal<ReadonlySet<string>>(new Set());

  protected readonly prefs = computed<ServicePrefs>(() => this.stored() ?? SERVICE_PREF_DEFAULTS);
  protected readonly unavailable = computed(() => this.stored() === null);
  protected readonly statusLine = computed(() => statusLineOf(this.status()));
  protected readonly statusActions = computed(() => statusActionsOf(this.status()));
  protected readonly rows = computed(() => componentRowsOf(this.status(), this.mcp()));
  protected readonly logFolder = computed(() => this.status().logFolder);

  protected readonly levels = LOG_LEVEL_CHOICES;
  protected readonly levelKeys = LOG_LEVEL_KEYS;
  protected readonly actionKeys = SERVICE_ACTION_KEYS;

  constructor() {
    void this.refresh(true);
    const timer = setInterval(() => void this.refresh(false), REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected since(date: Date): string {
    return this.i18n.formatTime(date);
  }

  private async refresh(withPrefs: boolean): Promise<void> {
    const [status, prefs, mcp] = await Promise.all([
      this.client.status(),
      withPrefs ? this.client.prefs() : Promise.resolve(this.stored()),
      window.dreyApi?.getMcpStatus?.().catch(() => null) ?? Promise.resolve(null),
    ]);
    this.status.set(status);
    this.stored.set(prefs);
    this.mcp.set(mcp);
  }

  private async store(patch: Partial<ServicePrefs>): Promise<void> {
    const next = await this.client.setPrefs(patch);
    this.stored.set(next);
  }

  protected toggle(key: 'enabled' | 'autostart' | 'lowPriority', checked: boolean): void {
    void this.store(key === 'enabled' && !checked ? { enabled: false, autostart: false } : { [key]: checked });
  }

  protected setTray(shown: boolean): void {
    void this.store({ trayIcon: shown });
  }

  /** A whole-number field, committed when it is left or Enter is pressed; a refused value goes back to the stored one. */
  protected commitNumber(field: NumberField, input: HTMLInputElement): void {
    const [min, max] = NUMBER_FIELDS[field];
    const value = wholeNumberIn(input.value, min, max);
    if (value === null) {
      this.mark(field, true);
      input.value = String(this.prefs()[field]);
      return;
    }
    this.mark(field, false);
    void this.store({ [field]: value });
  }

  protected commitQuiet(input: HTMLInputElement): void {
    const value = parseQuietHours(input.value);
    if (value === null) {
      this.mark('quietHours', true);
      input.value = this.prefs().quietHours;
      return;
    }
    this.mark('quietHours', false);
    input.value = value;
    void this.store({ quietHours: value });
  }

  private mark(field: string, bad: boolean): void {
    this.invalid.update((set) => {
      const next = new Set(set);
      if (bad) {
        next.add(field);
      } else {
        next.delete(field);
      }
      return next;
    });
  }

  protected pickLevel(level: ServiceLogLevel): void {
    this.levelMenu.set(false);
    void this.store({ logLevel: level });
  }

  protected openLogFolder(): void {
    void this.client.openLogFolder();
  }

  /** Open Drey Service… (its window, req-165), Restart or Stop (or Start) of the whole service, from the status item. */
  protected serviceAction(action: StatusAction): void {
    if (action === 'open') {
      void this.run('status:open', () => this.client.control({ target: 'window', action: 'open' }));
      return;
    }
    void this.run(`status:${action}`, () => this.client.control({ target: 'service', action }));
  }

  /** A component's button: the runner and the service go through the service's control API, the gateway and MCP through the setting that switches them. */
  protected rowAction(row: ComponentRow, action: ServiceAction): void {
    const key = `${row.id}:${action}`;
    switch (row.route) {
      case 'runner':
        void this.run(key, () => this.client.control({ target: 'runner', action } satisfies ServiceControlRequest));
        break;
      case 'gateway':
        void this.run(key, () => this.switchGateway(action));
        break;
      case 'mcp':
        void this.run(key, () => this.switchMcp(action));
        break;
      default:
        break;
    }
  }

  private async switchGateway(action: ServiceAction): Promise<{ ok: boolean }> {
    if (action !== 'start') {
      await this.client.setGateway(false);
    }
    if (action !== 'stop') {
      await this.client.setGateway(true);
    }
    return { ok: true };
  }

  /** Drey's own MCP server for other programs stays in Drey (req-167 gave the workers the service's): its switch is the `mcp` setting. */
  private async switchMcp(action: ServiceAction): Promise<{ ok: boolean }> {
    if (action !== 'start') {
      this.settings.patchMcp({ enabled: false });
      await this.settings.flush();
    }
    if (action !== 'stop') {
      this.settings.patchMcp({ enabled: true, httpEnabled: true });
      await this.settings.flush();
    }
    return { ok: true };
  }

  private async run(key: string, call: () => Promise<{ ok: boolean }>): Promise<void> {
    if (this.busy() !== null) {
      return;
    }
    this.busy.set(key);
    try {
      await call();
    } finally {
      this.busy.set(null);
      await this.refresh(true);
    }
  }
}
