/**
 * The status dot on Drey's icon (req-276): composed at runtime onto the app
 * icon's bitmap at each size the tray and the taskbar ask for, in the
 * top-right corner, with a transparent ring cut out of the icon around it
 * so the dot reads on any picture. Pure: BGRA premultiplied buffers in and
 * out — the format of `nativeImage.toBitmap()` / `createFromBitmap` on
 * Windows. Plus the menu header's dot.
 */
import type { Rgb } from './tray-status';

const SAMPLES = 4;

export interface DotGeometry {
  /** Centre, in pixels from the top-left corner. */
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  /** Width of the transparent ring around the dot. */
  readonly ring: number;
}

/**
 * The dot at `size`: a bit under half the icon, touching its top and right
 * edges, the ring one pixel at 16 px. Whole-pixel diameters keep the
 * circle's edge on the pixel grid (16 → 7, 24 → 11, 32 → 14).
 */
export function dotGeometry(size: number): DotGeometry {
  const diameter = Math.max(5, Math.round(size * 0.44));
  const radius = diameter / 2;
  return { cx: size - radius, cy: radius, radius, ring: Math.max(1, Math.round(size / 16)) };
}

/** Coverage of pixel (x, y) by the circle around (cx, cy), supersampled. */
function circleCoverage(x: number, y: number, cx: number, cy: number, radius: number): number {
  let hits = 0;
  for (let sy = 0; sy < SAMPLES; sy++) {
    for (let sx = 0; sx < SAMPLES; sx++) {
      const dx = x + (sx + 0.5) / SAMPLES - cx;
      const dy = y + (sy + 0.5) / SAMPLES - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        hits++;
      }
    }
  }
  return hits / (SAMPLES * SAMPLES);
}

/** Paints `rgb` at `alpha` over the premultiplied BGRA pixel at `offset`. */
function over(buffer: Buffer, offset: number, rgb: Rgb, alpha: number): void {
  const rest = 1 - alpha;
  buffer[offset] = Math.round(rgb[2] * alpha + buffer[offset]! * rest);
  buffer[offset + 1] = Math.round(rgb[1] * alpha + buffer[offset + 1]! * rest);
  buffer[offset + 2] = Math.round(rgb[0] * alpha + buffer[offset + 2]! * rest);
  buffer[offset + 3] = Math.round(255 * alpha + buffer[offset + 3]! * rest);
}

/** A copy of the `size`×`size` icon bitmap with the dot in `rgb` top right. */
export function composeStatusDot(icon: Buffer, size: number, rgb: Rgb): Buffer {
  if (icon.length !== size * size * 4) {
    // A programming error, never shown in the UI. i18n-ignore
    throw new Error(`composeStatusDot: ${icon.length} bytes is not a ${size}×${size} BGRA bitmap`);
  }
  const out = Buffer.from(icon);
  const { cx, cy, radius, ring } = dotGeometry(size);
  const outer = radius + ring;
  const top = Math.max(0, Math.floor(cy - outer));
  const bottom = Math.min(size, Math.ceil(cy + outer));
  const left = Math.max(0, Math.floor(cx - outer));
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < size; x++) {
      const offset = (y * size + x) * 4;
      const keep = 1 - circleCoverage(x, y, cx, cy, outer);
      for (let channel = 0; channel < 4; channel++) {
        out[offset + channel] = Math.round(out[offset + channel]! * keep);
      }
      over(out, offset, rgb, circleCoverage(x, y, cx, cy, radius));
    }
  }
  return out;
}

/** The menu header's dot: a centred circle in `rgb` on transparency. */
export function dotBitmap(size: number, rgb: Rgb): Buffer {
  const buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      over(buffer, (y * size + x) * 4, rgb, circleCoverage(x, y, size / 2, size / 2, size * 0.4));
    }
  }
  return buffer;
}
