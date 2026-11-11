/**
 * The tray icon and its menu (req-165, board 8a's inset): present while
 * `service.trayIcon` is shown, its picture and menu refreshed from the
 * service every few seconds. The picture is Drey's icon with the status
 * dot, the tooltip the state in words (req-276). A click opens the window.
 * Every entry is a call to the service, the runner or the engine — the
 * tray holds nothing.
 */
import { Menu, Tray, type NativeImage } from 'electron';
import { i18n } from '../../shared/i18n';
import type { Confirmations } from './confirmations';
import type { DreyLauncher } from './drey-launcher';
import type { ServiceCalls } from './service-calls';
import { isLive } from './snapshot-map';
import { trayMenuTemplate, type TrayActions, type TrayState } from './tray-menu';
import { trayTooltip, trayVerdictOf, type TrayStatus, type TrayVerdict } from './tray-status';

/** The pictures the tray draws (`StatusIcons`). */
export interface TrayPictures {
  tray(status: TrayStatus): NativeImage;
  menuDot(status: TrayStatus): NativeImage;
}

export interface TrayDeps {
  readonly calls: ServiceCalls;
  readonly confirmations: Confirmations;
  readonly drey: DreyLauncher;
  readonly pictures: TrayPictures;
  readonly openWindow: () => void;
}

const UNKNOWN: TrayVerdict = { status: 'stopped', problem: null };
const translate = (key: string, params?: Record<string, string | number>): string => i18n.lookup(key, params);

export class TrayController {
  private tray: Tray | null = null;
  private verdict: TrayVerdict = UNKNOWN;
  private state: TrayState = { running: false, status: UNKNOWN.status, autopilot: 'off', liveRuns: 0, autostart: false };

  constructor(private readonly deps: TrayDeps) {}

  get visible(): boolean {
    return this.tray !== null;
  }

  /** The service's state as of the last refresh. */
  get status(): TrayStatus {
    return this.verdict.status;
  }

  /** The state and its words for the window's taskbar overlay (the words are the tooltip's). */
  get windowStatus(): { readonly status: TrayStatus; readonly description: string } {
    return { status: this.verdict.status, description: trayTooltip(this.verdict, translate) };
  }

  /** Shows or drops the icon (`service.trayIcon`). */
  setVisible(visible: boolean): void {
    if (visible && this.tray === null) {
      this.tray = new Tray(this.deps.pictures.tray(this.verdict.status));
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
    const [locked, status, runs, autopilot] = await Promise.all([calls.locked(), calls.status(), calls.runs(), calls.autopilot()]);
    const settings = (status?.['settings'] ?? {}) as { enabled?: unknown; autostart?: unknown };
    this.verdict = trayVerdictOf({ locked, status, autopilot });
    this.state = {
      running: status !== null,
      status: this.verdict.status,
      autopilot,
      liveRuns: runs.filter(isLive).length,
      autostart: settings.enabled === true && settings.autostart === true,
    };
    this.render();
  }

  destroy(): void {
    this.setVisible(false);
  }

  private render(): void {
    if (this.tray === null) {
      return;
    }
    const { pictures } = this.deps;
    const t = translate;
    this.tray.setImage(pictures.tray(this.verdict.status));
    this.tray.setToolTip(trayTooltip(this.verdict, t));
    this.tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(this.state, this.actions(), t, pictures.menuDot(this.verdict.status))));
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
