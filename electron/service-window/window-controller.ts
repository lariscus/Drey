/**
 * The Drey Service window (req-165/166, boards 8a/8b): one frameless
 * 1100×720 window, sandboxed, its page the `apps/service-window` build
 * loaded from disk. Created when asked, destroyed when closed — a window
 * nobody looks at costs no renderer process; the tray stays. Its icon is
 * Drey's with the status dot (req-276), so the taskbar button tells the
 * service's state like the tray does.
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

/** The window's icon per status (`StatusIcons`). */
export interface WindowPictures {
  window(status: TrayStatus): NativeImage;
}

export class ServiceWindowController {
  private window: BrowserWindow | null = null;
  private status: TrayStatus = 'stopped';
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
      this.sendTab(tab);
    });
  }

  /** The service's state for the window's (the taskbar button's) icon. */
  setStatus(status: TrayStatus): void {
    if (status === this.status) {
      return;
    }
    this.status = status;
    if (this.window !== null && !this.window.isDestroyed()) {
      this.window.setIcon(this.pictures.window(status));
    }
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
      icon: this.pictures.window(this.status),
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
