/**
 * Browser-only raster export: SVG → Blob → Image → Canvas → PNG/JPEG.
 */

export const MAX_RASTER_SIZE = 2048;

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to render the SVG.'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Unable to encode the image.'))), type, quality);
  });
}

export interface RasterOptions {
  size: number;
  format: 'png' | 'jpeg';
  /** Required for JPEG, which has no alpha channel. */
  background?: string;
  quality?: number;
}

export async function svgToRaster(svg: string, { size, format, background, quality = 0.92 }: RasterOptions): Promise<Blob> {
  const px = Math.round(Math.min(Math.max(size, 1), MAX_RASTER_SIZE));
  const image = await loadSvgImage(svg);
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not supported in this browser.');

  if (format === 'jpeg') {
    ctx.fillStyle = background ?? '#ffffff';
    ctx.fillRect(0, 0, px, px);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, px, px);
  return canvasToBlob(canvas, format === 'png' ? 'image/png' : 'image/jpeg', format === 'jpeg' ? quality : undefined);
}
