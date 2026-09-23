/**
 * Composes a cut-out image onto its final canvas: optional recolor, trim,
 * padding, square canvas, background color and corner radius.
 */

export interface ComposeOptions {
  /** null = transparent */
  background: string | null;
  /** Recolors every visible pixel, keeping its transparency (for logos/icons). */
  tint: string | null;
  padding: number; // % of the longest content side
  radius: number; // 0–50 %
  trim: boolean;
  square: boolean;
  /** Longest output side in px; null keeps the working resolution. */
  size: number | null;
}

export interface ComposeLayout {
  /** Where the source image's (0,0) lands on the output canvas, and its scale. */
  offsetX: number;
  offsetY: number;
  scale: number;
  width: number;
  height: number;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function contentBounds(image: ImageData, threshold = 8): Bounds {
  const { width, height, data } = image;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: width, h: height };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function toCanvas(image: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d')!.putImageData(image, 0, 0);
  return canvas;
}

function roundedRect(ctx: CanvasRenderingContext2D, w: number, h: number, r: number) {
  ctx.beginPath();
  if (r <= 0) ctx.rect(0, 0, w, h);
  else ctx.roundRect(0, 0, w, h, r);
  ctx.fill();
}

/** Renders into `target` (resized as needed) and returns the layout used. */
export function composeImage(
  cutout: ImageData,
  bounds: Bounds | null,
  options: ComposeOptions,
  target: HTMLCanvasElement = document.createElement('canvas'),
): { canvas: HTMLCanvasElement; layout: ComposeLayout } {
  const box = options.trim && bounds ? bounds : { x: 0, y: 0, w: cutout.width, h: cutout.height };
  const pad = (Math.max(box.w, box.h) * Math.min(Math.max(options.padding, 0), 45)) / 100;
  let innerW = box.w + pad * 2;
  let innerH = box.h + pad * 2;
  if (options.square) innerW = innerH = Math.max(innerW, innerH);

  const scale = options.size ? options.size / Math.max(innerW, innerH) : 1;
  const width = Math.max(1, Math.round(innerW * scale));
  const height = Math.max(1, Math.round(innerH * scale));
  target.width = width;
  target.height = height;
  const ctx = target.getContext('2d')!;
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';

  if (options.background) {
    ctx.fillStyle = options.background;
    roundedRect(ctx, width, height, (Math.min(width, height) * Math.min(options.radius, 50)) / 100);
  }

  const source = toCanvas(cutout);
  if (options.tint) {
    const tctx = source.getContext('2d')!;
    tctx.globalCompositeOperation = 'source-in';
    tctx.fillStyle = options.tint;
    tctx.fillRect(0, 0, source.width, source.height);
  }

  // Clip the artwork to the rounded background so corners stay clean.
  if (options.background && options.radius > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, (Math.min(width, height) * Math.min(options.radius, 50)) / 100);
    ctx.clip();
  }
  const dx = (innerW - box.w) / 2;
  const dy = (innerH - box.h) / 2;
  ctx.drawImage(source, box.x, box.y, box.w, box.h, dx * scale, dy * scale, box.w * scale, box.h * scale);
  if (options.background && options.radius > 0) ctx.restore();

  return {
    canvas: target,
    layout: { offsetX: (dx - box.x) * scale, offsetY: (dy - box.y) * scale, scale, width, height },
  };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality),
  );
}
