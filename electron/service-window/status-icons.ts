/**
 * Drey's app icon with the status dot (req-276), as the tray, the window's
 * taskbar button and the menu header take it. The icon is the one the
 * installer ships (`build/icon.png`, packaged as `resources/icon.png` by
 * `extraResources`), scaled once per size; each status' picture is built
 * on first use and kept.
 */
import { nativeImage, type NativeImage } from 'electron';
import * as path from 'node:path';
import { composeStatusDot, dotBitmap } from './tray-icon';
import { STATUS_COLOURS, type TrayStatus } from './tray-status';

/** Tray sizes per display scale: 100 %, 125 %, 150 %, 200 %. */
const TRAY_SIZES: readonly number[] = [16, 20, 24, 32];
/** The window icon: Windows scales the 1× bitmap for the title, taskbar and Alt-Tab. */
const WINDOW_SIZE = 64;
const MENU_DOT_SIZE = 16;

/** Where Drey's icon lies: next to the resources when packaged, in `build/` of a checkout. */
export function dreyIconPath(appPath: string, isPackaged: boolean, resourcesPath: string): string {
  return isPackaged ? path.join(resourcesPath, 'icon.png') : path.join(appPath, 'build', 'icon.png');
}

export class StatusIcons {
  private readonly icon: NativeImage;
  private readonly scaled = new Map<number, Buffer>();
  private readonly built = new Map<string, NativeImage>();

  constructor(iconPath: string) {
    this.icon = nativeImage.createFromPath(iconPath);
  }

  /** The tray's picture: one representation per display scale. */
  tray(status: TrayStatus): NativeImage {
    return this.cached(`tray:${status}`, () => {
      const image = nativeImage.createEmpty();
      for (const size of TRAY_SIZES) {
        image.addRepresentation({ width: size, height: size, scaleFactor: size / 16, buffer: this.withDot(status, size) });
      }
      return image;
    });
  }

  /** The window's (and so the taskbar button's) icon. */
  window(status: TrayStatus): NativeImage {
    return this.cached(`window:${status}`, () =>
      nativeImage.createFromBitmap(this.withDot(status, WINDOW_SIZE), { width: WINDOW_SIZE, height: WINDOW_SIZE }),
    );
  }

  /** The menu header's dot. */
  menuDot(status: TrayStatus): NativeImage {
    return this.cached(`menu:${status}`, () =>
      nativeImage.createFromBitmap(dotBitmap(MENU_DOT_SIZE, STATUS_COLOURS[status]), { width: MENU_DOT_SIZE, height: MENU_DOT_SIZE }),
    );
  }

  private cached(key: string, build: () => NativeImage): NativeImage {
    let image = this.built.get(key);
    if (image === undefined) {
      image = build();
      this.built.set(key, image);
    }
    return image;
  }

  private withDot(status: TrayStatus, size: number): Buffer {
    return composeStatusDot(this.iconAt(size), size, STATUS_COLOURS[status]);
  }

  /** The icon's BGRA bitmap at `size`; transparent when the file is missing, so the dot alone still tells the state. */
  private iconAt(size: number): Buffer {
    let bitmap = this.scaled.get(size);
    if (bitmap === undefined) {
      const resized = this.icon.isEmpty() ? null : this.icon.resize({ width: size, height: size, quality: 'best' }).toBitmap();
      bitmap = resized !== null && resized.length === size * size * 4 ? resized : Buffer.alloc(size * size * 4);
      this.scaled.set(size, bitmap);
    }
    return bitmap;
  }
}
