// i18n: catalog
/**
 * The picture a persona gets from the owner's file (req-288, D-67): any image
 * the page can draw, centred and cropped to a square and drawn onto a
 * 256 × 256 PNG — the engine takes a PNG only, at most 2 MB, and the circles
 * draw it at 72 px at most. Read through `FileReader` (a data URL: the page's
 * CSP allows `data:` images, not `blob:`).
 */

/** The side of the PNG the page sends. */
export const PICTURE_SIZE = 256;

function dataUrlOf(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(reader.error ?? new Error()));
    reader.readAsDataURL(file);
  });
}

function imageOf(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', () => reject(new Error()));
    image.src = url;
  });
}

/** The square crop of an image of `width` × `height`: its largest centred square. */
export function squareCropOf(width: number, height: number): { readonly x: number; readonly y: number; readonly side: number } {
  const side = Math.min(width, height);
  return { x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), side };
}

/** The file as the PNG data URL the engine stores; rejects for a file that is no image. */
export async function squarePngOf(file: Blob): Promise<string> {
  const image = await imageOf(await dataUrlOf(file));
  const crop = squareCropOf(image.naturalWidth, image.naturalHeight);
  if (crop.side === 0) {
    throw new Error();
  }
  const canvas = document.createElement('canvas');
  canvas.width = PICTURE_SIZE;
  canvas.height = PICTURE_SIZE;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error();
  }
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, crop.x, crop.y, crop.side, crop.side, 0, 0, PICTURE_SIZE, PICTURE_SIZE);
  return canvas.toDataURL('image/png');
}
