/**
 * The tray icon (req-165): the title bar's accent square with its `D`,
 * drawn as a BGRA bitmap so the installer ships no extra asset — accent
 * blue while the service runs, grey when it is gone. Plus the menu header's
 * green dot. Pure; `nativeImage.createFromBitmap` takes the buffers.
 */
export type TrayIconState = 'running' | 'stopped';

type Rgb = readonly [number, number, number];

const ACCENT: Rgb = [0x8e, 0xcb, 0xef];
const GREY: Rgb = [0x74, 0x79, 0x80];
const INK: Rgb = [0x10, 0x11, 0x13];
const GREEN: Rgb = [0x93, 0xc4, 0x7f];
const SAMPLES = 4;

function inRoundedSquare(u: number, v: number, radius: number): boolean {
  const dx = Math.max(radius - u, 0, u - (1 - radius));
  const dy = Math.max(radius - v, 0, v - (1 - radius));
  return dx * dx + dy * dy <= radius * radius;
}

/** The `D`: a stem and a half ring, in unit coordinates of the square. */
export function inLetterD(u: number, v: number): boolean {
  if (u >= 0.3 && u <= 0.42 && v >= 0.24 && v <= 0.76) {
    return true;
  }
  if (u < 0.42) {
    return false;
  }
  const outer = ((u - 0.42) / 0.26) ** 2 + ((v - 0.5) / 0.26) ** 2;
  const inner = ((u - 0.42) / 0.13) ** 2 + ((v - 0.5) / 0.14) ** 2;
  return outer <= 1 && inner >= 1;
}

/** Coverage of one pixel by a shape, supersampled. */
function coverage(x: number, y: number, size: number, inside: (u: number, v: number) => boolean): number {
  let hits = 0;
  for (let sy = 0; sy < SAMPLES; sy++) {
    for (let sx = 0; sx < SAMPLES; sx++) {
      if (inside((x + (sx + 0.5) / SAMPLES) / size, (y + (sy + 0.5) / SAMPLES) / size)) {
        hits++;
      }
    }
  }
  return hits / (SAMPLES * SAMPLES);
}

function put(buffer: Buffer, offset: number, rgb: Rgb, alpha: number): void {
  // BGRA, premultiplied.
  buffer[offset] = Math.round(rgb[2] * alpha);
  buffer[offset + 1] = Math.round(rgb[1] * alpha);
  buffer[offset + 2] = Math.round(rgb[0] * alpha);
  buffer[offset + 3] = Math.round(255 * alpha);
}

/** The tray icon's bitmap at `size`×`size`. */
export function trayIconBitmap(state: TrayIconState, size: number): Buffer {
  const buffer = Buffer.alloc(size * size * 4);
  const fill = state === 'running' ? ACCENT : GREY;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const square = coverage(x, y, size, (u, v) => inRoundedSquare(u, v, 0.2));
      const letter = coverage(x, y, size, (u, v) => inRoundedSquare(u, v, 0.2) && inLetterD(u, v));
      const body = square - letter;
      const alpha = square;
      const mix: Rgb = alpha === 0 ? fill : [0, 1, 2].map((i) => (fill[i]! * body + INK[i]! * letter) / alpha) as unknown as Rgb;
      put(buffer, (y * size + x) * 4, mix, alpha);
    }
  }
  return buffer;
}

/** The menu header's dot (board 8a: green while running). */
export function dotBitmap(size: number): Buffer {
  const buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const alpha = coverage(x, y, size, (u, v) => (u - 0.5) ** 2 + (v - 0.5) ** 2 <= 0.16);
      put(buffer, (y * size + x) * 4, GREEN, alpha);
    }
  }
  return buffer;
}
