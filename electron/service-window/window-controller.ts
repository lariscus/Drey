/**
 * The Drey Service window (req-165/166, boards 8a/8b): one frameless
 * 1100×720 window, sandboxed, its page the `apps/service-window` build
 * loaded from disk. Created when asked, destroyed when closed — a window
 * nobody looks at costs no renderer process; the tray stays. Its icon is
 * Drey's; Windows' taskbar overlay carries the status dot (req-276), so the
 * button tells the service's state like the tray does.
 */
import { BrowserWindow, type NativeImage } from 'electron';
import * as path from 'node:path';
import { i18n } from '../../shared/i18n';
import { SERVICE_WINDOW_CHANNELS, type ServiceWindowTab } from '../../shared/service-window/contract';
import type { TrayStatus } from './tray-status';

export interface WindowPaths {
  /** `dist/service-window/browser/index.html`. */
  readonly page: string;
  readonly preload: string;
}

export function windowPaths(appPath: string, mainDir: string): WindowPaths {
  return {
    page: path.join(appPath, 'dist', 'service-window', 'browser', 'index.html'),
    preload: path.join(mainDir, 'service-window-preload.js'),
  };
}

/** The window's icon and its taskbar overlay per status (`StatusIcons`). */
export interface WindowPictures {
  windowIcon(): NativeImage;
  overlay(status: TrayStatus): NativeImage;
}

/** The service's state as the taskbar overlay shows it: the dot and its words for assistive technology. */
export interface WindowStatus {
  readonly status: TrayStatus;
  readonly description: string;
}

export class ServiceWindowController {
  private window: BrowserWindow | null = null;
  private status: WindowStatus | null = null;
  private readonly closedListeners: Array<() => void> = [];

  constructor(
    private readonly paths: WindowPaths,
    private readonly pictures: WindowPictures,
  ) {}

  get current(): BrowserWindow | null {
    return this.window;
  }

  onClosed(listener: () => void): void {
    this.closedListeners.push(listener);
  }

  /** Opens the window, or brings it to the front; `tab` switches to that tab. */
  show(tab?: ServiceWindowTab): void {
    if (this.window !== null) {
      if (this.window.isMinimized()) {
        this.window.restore();
      }
      this.window.show();
      this.window.focus();
      this.sendTab(tab);
      return;
    }
    const win = this.create();
    win.once('ready-to-show', () => {
      win.show();
      // The taskbar button exists once the window shows.
      this.applyOverlay();
      this.sendTab(tab);
    });
  }

  /** The service's state for the taskbar button's overlay. */
  setStatus(next: WindowStatus): void {
    if (next.status === this.status?.status && next.description === this.status.description) {
      return;
    }
    this.status = next;
    this.applyOverlay();
  }

  /** Windows only, and Windows places it (top right on 11, bottom right on 10); null clears it. */
  private applyOverlay(): void {
    const win = this.window;
    if (process.platform !== 'win32' || win === null || win.isDestroyed()) {
      return;
    }
    const status = this.status;
    win.setOverlayIcon(status === null ? null : this.pictures.overlay(status.status), status?.description ?? '');
  }

  send(channel: string, payload: unknown): void {
    if (this.window !== null && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, payload);
    }
  }

  close(): void {
    this.window?.close();
  }

  private sendTab(tab: ServiceWindowTab | undefined): void {
    if (tab !== undefined) {
      this.send(SERVICE_WINDOW_CHANNELS.showTab, tab);
    }
  }

  private create(): BrowserWindow {
    const win = new BrowserWindow({
      width: 1100,
      height: 720,
      minWidth: 900,
      minHeight: 560,
      frame: false,
      show: false,
      title: i18n.t('service_tray.window_title'),
      backgroundColor: '#18191b',
      icon: this.pictures.windowIcon(),
      webPreferences: { preload: this.paths.preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    win.removeMenu();
    // The page is the only content: no new windows, no navigation away from it.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.on('closed', () => {
      this.window = null;
      this.closedListeners.forEach((listener) => listener());
    });
    void win.loadFile(this.paths.page);
    this.window = win;
    return win;
  }
}
