/**
 * The tray icon and its menu (req-165, board 8a's inset): present while
 * `service.trayIcon` is shown, its picture and menu refreshed from the
 * service every few seconds. A click opens the window. Every entry is a
 * call to the service, the runner or the engine — the tray holds nothing.
 */
import { Menu, Tray, nativeImage, type NativeImage } from 'electron';
import { i18n } from '../../shared/i18n';
import type { Confirmations } from './confirmations';
import type { DreyLauncher } from './drey-launcher';
import type { ServiceCalls } from './service-calls';
import { isLive } from './snapshot-map';
import { dotBitmap, trayIconBitmap, type TrayIconState } from './tray-icon';
import { trayMenuTemplate, type TrayActions, type TrayState } from './tray-menu';

export interface TrayDeps {
  readonly calls: ServiceCalls;
  readonly confirmations: Confirmations;
  readonly drey: DreyLauncher;
  readonly openWindow: () => void;
}

const image = (state: TrayIconState): NativeImage => {
  const icon = nativeImage.createFromBitmap(trayIconBitmap(state, 32), { width: 32, height: 32, scaleFactor: 2 });
  icon.addRepresentation({ width: 16, height: 16, scaleFactor: 1, buffer: trayIconBitmap(state, 16) });
  return icon;
};

export class TrayController {
  private tray: Tray | null = null;
  private state: TrayState = { running: false, autopilot: 'off', liveRuns: 0, autostart: false };
  private readonly headerDot = nativeImage.createFromBitmap(dotBitmap(16), { width: 16, height: 16 });

  constructor(private readonly deps: TrayDeps) {}

  get visible(): boolean {
    return this.tray !== null;
  }

  /** Shows or drops the icon (`service.trayIcon`). */
  setVisible(visible: boolean): void {
    if (visible && this.tray === null) {
      this.tray = new Tray(image(this.state.running ? 'running' : 'stopped'));
      this.tray.on('click', () => this.deps.openWindow());
      this.tray.on('double-click', () => this.deps.openWindow());
      this.render();
    } else if (!visible && this.tray !== null) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  /** Reads the service's state now and redraws the icon and the menu. */
  async refresh(): Promise<void> {
    const { calls } = this.deps;
    const [status, runs, autopilot] = await Promise.all([calls.status(), calls.runs(), calls.autopilot()]);
    const settings = (status?.['settings'] ?? {}) as { enabled?: unknown; autostart?: unknown };
    this.state = { running: status !== null, autopilot, liveRuns: runs.filter(isLive).length, autostart: settings.enabled === true && settings.autostart === true };
    this.render();
  }

  destroy(): void {
    this.setVisible(false);
  }

  private render(): void {
    if (this.tray === null) {
      return;
    }
    const header = i18n.t(this.state.running ? 'service_tray.header.running' : 'service_tray.header.stopped');
    this.tray.setImage(image(this.state.running ? 'running' : 'stopped'));
    this.tray.setToolTip(header);
    const t = (key: string, params?: Record<string, string | number>): string => i18n.lookup(key, params);
    this.tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(this.state, this.actions(), t, this.state.running ? this.headerDot : undefined)));
  }

  private actions(): TrayActions {
    const { calls, confirmations, drey } = this.deps;
    const after = (work: Promise<unknown>): void => {
      void work.then(() => this.refresh());
    };
    return {
      openWindow: () => this.deps.openWindow(),
      openDrey: () => drey.open(),
      setAutopilot: (state) => after(calls.setAutopilot(state)),
      stopAll: () => after(confirmations.stopAll(this.state.liveRuns).then((yes) => (yes ? calls.stopAll() : null))),
      setAutostart: (on) => {
        this.state = { ...this.state, autostart: on };
        after(calls.setAutostart(on));
      },
      quit: () => after(confirmations.quitService(this.state.liveRuns).then((yes) => (yes ? calls.shutdown() : null))),
    };
  }
}
