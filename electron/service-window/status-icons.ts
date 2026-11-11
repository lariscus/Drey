/**
 * Drey's app icon with the status dot (req-276), as the tray, the window's
 * taskbar overlay and the menu header take it, plus the window's plain icon.
 * The icon is the one the installer ships (`build/icon.png` / `icon.ico`,
 * packaged as `resources/icon.png` / `icon.ico` by `extraResources`), scaled
 * once per size; each status' picture is built on first use and kept.
 */
import { nativeImage, type NativeImage } from 'electron';
import * as path from 'node:path';
import { composeStatusDot, dotBitmap, overlayDotBitmap } from './tray-icon';
import { STATUS_COLOURS, type TrayStatus } from './tray-status';

/** Tray sizes per display scale: 100 %, 125 %, 150 %, 200 %. */
const TRAY_SIZES: readonly number[] = [16, 20, 24, 32];
/** The taskbar overlay: Windows scales the 1× bitmap down to the overlay's 16 px (more on a scaled display). */
const OVERLAY_SIZE = 32;
const MENU_DOT_SIZE = 16;

/** Where Drey's icon lies (`ext` `png` or `ico`): next to the resources when packaged, in `build/` of a checkout. */
export function dreyIconPath(appPath: string, isPackaged: boolean, resourcesPath: string, ext: 'png' | 'ico'): string {
  return path.join(isPackaged ? resourcesPath : path.join(appPath, 'build'), `icon.${ext}`);
}

export class StatusIcons {
  private readonly icon: NativeImage;
  private readonly scaled = new Map<number, Buffer>();
  private readonly built = new Map<string, NativeImage>();

  /** `pngPath` is drawn on; `icoPath` is the window's own icon (its frames are what Windows wants). */
  constructor(
    pngPath: string,
    private readonly icoPath: string,
  ) {
    this.icon = nativeImage.createFromPath(pngPath);
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

  /** The window's (and so the taskbar button's) icon: Drey's, plain. */
  windowIcon(): NativeImage {
    return this.cached('window', () => {
      const ico = nativeImage.createFromPath(this.icoPath);
      return ico.isEmpty() ? this.icon : ico;
    });
  }

  /** The taskbar button's overlay (`setOverlayIcon`): the dot alone, centred; Windows places it. */
  overlay(status: TrayStatus): NativeImage {
    return this.cached(`overlay:${status}`, () =>
      nativeImage.createFromBitmap(overlayDotBitmap(OVERLAY_SIZE, STATUS_COLOURS[status]), { width: OVERLAY_SIZE, height: OVERLAY_SIZE }),
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
