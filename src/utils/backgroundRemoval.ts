/**
 * Client-side background removal for images with fairly uniform backgrounds
 * (logos, icons, product shots, screenshots). Nothing is uploaded anywhere.
 *
 * The mask is rebuilt by replaying operations:
 * 1. an automatic pass that flood-fills from the image border using the
 *    detected background color, then
 * 2. manual "remove"/"restore" clicks (magic-wand style), in order.
 *
 * Edge pixels next to removed areas get partial alpha based on how close they
 * are to the removed color, and that color is un-mixed from them so no halo
 * of the old background is left behind.
 */

export interface WorkingImage {
  width: number;
  height: number;
  /** RGBA pixels */
  data: Uint8ClampedArray;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export type RemovalOp =
  | { kind: 'remove'; x: number; y: number; tolerance: number; contiguous: boolean }
  | { kind: 'restore'; x: number; y: number; tolerance: number };

export interface RemovalSettings {
  auto: boolean;
  tolerance: number; // 0–100
  contiguous: boolean;
  smoothing: number; // 0–100
  cleanHalo: boolean;
  /** Also remove enclosed background-colored areas (e.g. inside letters). */
  removeHoles: boolean;
  /** Enclosed areas up to this % of the image are treated as holes. */
  holeSize: number;
}

export const MAX_WORKING_SIZE = 2048;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_OPS = 250;

/** Maps the 0–100 slider to an RGB distance threshold. */
const toDistance = (tolerance: number) => Math.max(1, tolerance * 2.6);

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export class ImageLoadError extends Error {}

export async function loadImageFile(file: Blob): Promise<WorkingImage> {
  if (!file.type.startsWith('image/')) throw new ImageLoadError('Please choose an image file (PNG, JPG, WebP, GIF or SVG).');
  if (file.size > MAX_FILE_BYTES) throw new ImageLoadError('That image is larger than 25 MB. Please choose a smaller file.');

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new ImageLoadError('This image format isn’t supported by your browser. Try PNG, JPG or WebP.'));
      el.src = url;
    });
    const naturalW = img.naturalWidth || 512;
    const naturalH = img.naturalHeight || 512;
    const scale = Math.min(1, MAX_WORKING_SIZE / Math.max(naturalW, naturalH));
    const width = Math.max(1, Math.round(naturalW * scale));
    const height = Math.max(1, Math.round(naturalH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new ImageLoadError('Your browser doesn’t support canvas image editing.');
    ctx.drawImage(img, 0, 0, width, height);
    return { width, height, data: ctx.getImageData(0, 0, width, height).data };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const TRANSPARENT = 16;

function distSq(data: Uint8ClampedArray, i: number, c: RGB) {
  const dr = data[i] - c.r;
  const dg = data[i + 1] - c.g;
  const db = data[i + 2] - c.b;
  return dr * dr + dg * dg + db * db;
}

export function pixelColor(img: WorkingImage, x: number, y: number): RGB {
  const i = (Math.min(img.height - 1, Math.max(0, y)) * img.width + Math.min(img.width - 1, Math.max(0, x))) * 4;
  return { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] };
}

export function rgbToHex({ r, g, b }: RGB) {
  return `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The most common color along the image border (quantized buckets, then
 * averaged). Returns null when the border is already mostly transparent.
 */
export function estimateBackground(img: WorkingImage): RGB | null {
  const { width, height, data } = img;
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let transparent = 0;
  let total = 0;
  const step = Math.max(1, Math.floor((width + height) / 800));
  const sample = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    total++;
    if (data[i + 3] < TRANSPARENT) {
      transparent++;
      return;
    }
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const b = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    b.n++;
    b.r += data[i];
    b.g += data[i + 1];
    b.b += data[i + 2];
    buckets.set(key, b);
  };
  for (let x = 0; x < width; x += step) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    sample(0, y);
    sample(width - 1, y);
  }
  if (transparent > total * 0.5) return null;
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const b of buckets.values()) if (!best || b.n > best.n) best = b;
  return best ? { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n } : null;
}

// ---------------------------------------------------------------------------
// Mask building
// ---------------------------------------------------------------------------

/**
 * owner[i] = 0 → keep the pixel; k > 0 → removed by color colors[k - 1].
 */
export interface Mask {
  owner: Uint16Array;
  colors: RGB[];
  /** Enclosed background-colored areas found by the auto pass. */
  holes: { removed: number; kept: number };
}

function flood(
  img: WorkingImage,
  seeds: number[],
  target: RGB,
  maxDist: number,
  contiguous: boolean,
  apply: (p: number) => void,
) {
  const { width, height, data } = img;
  const n = width * height;
  const limit = maxDist * maxDist;
  const matches = (p: number) => {
    const i = p * 4;
    return data[i + 3] < TRANSPARENT || distSq(data, i, target) <= limit;
  };

  if (!contiguous) {
    for (let p = 0; p < n; p++) if (matches(p)) apply(p);
    return;
  }

  const visited = new Uint8Array(n);
  const stack = new Int32Array(n);
  let top = 0;
  for (const s of seeds) {
    if (s >= 0 && s < n && !visited[s] && matches(s)) {
      visited[s] = 1;
      stack[top++] = s;
    }
  }
  while (top > 0) {
    const p = stack[--top];
    apply(p);
    const x = p % width;
    const push = (q: number) => {
      if (!visited[q] && matches(q)) {
        visited[q] = 1;
        stack[top++] = q;
      }
    };
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (p >= width) push(p - width);
    if (p < n - width) push(p + width);
  }
}

function borderSeeds(img: WorkingImage) {
  const { width, height } = img;
  const seeds: number[] = [];
  for (let x = 0; x < width; x++) seeds.push(x, (height - 1) * width + x);
  for (let y = 1; y < height - 1; y++) seeds.push(y * width, y * width + width - 1);
  return seeds;
}

/**
 * Finds regions that match the background color but aren't connected to the
 * edge — typically the counters of letters like "o", "e", "d". Small ones are
 * removed; large ones (often intentional white shapes in a logo) are kept.
 */
function removeEnclosed(img: WorkingImage, owner: Uint16Array, target: RGB, maxDist: number, maxArea: number, id: number) {
  const { width, height, data } = img;
  const n = width * height;
  const limit = maxDist * maxDist;
  const visited = new Uint8Array(n);
  const stack = new Int32Array(n);
  const region: number[] = [];
  let removed = 0;
  let kept = 0;
  const minArea = Math.max(4, n * 0.00002); // ignore specks of noise

  for (let start = 0; start < n; start++) {
    if (visited[start] || owner[start] || distSq(data, start * 4, target) > limit) continue;
    region.length = 0;
    let top = 0;
    visited[start] = 1;
    stack[top++] = start;
    while (top > 0) {
      const p = stack[--top];
      region.push(p);
      const x = p % width;
      const push = (q: number) => {
        if (!visited[q] && !owner[q] && distSq(data, q * 4, target) <= limit) {
          visited[q] = 1;
          stack[top++] = q;
        }
      };
      if (x > 0) push(p - 1);
      if (x < width - 1) push(p + 1);
      if (p >= width) push(p - width);
      if (p < n - width) push(p + width);
    }
    if (region.length < minArea) continue;
    if (region.length <= maxArea) {
      for (const p of region) owner[p] = id;
      removed++;
    } else {
      kept++;
    }
  }
  return { removed, kept };
}

export function buildMask(img: WorkingImage, settings: RemovalSettings, ops: RemovalOp[], autoColor: RGB | null): Mask {
  const owner = new Uint16Array(img.width * img.height);
  const colors: RGB[] = [];
  let holes = { removed: 0, kept: 0 };

  if (settings.auto && autoColor) {
    colors.push(autoColor);
    const id = colors.length;
    const dist = toDistance(settings.tolerance);
    flood(img, borderSeeds(img), autoColor, dist, settings.contiguous, (p) => (owner[p] = id));
    if (settings.contiguous) {
      const maxArea = settings.removeHoles ? (img.width * img.height * settings.holeSize) / 100 : 0;
      holes = removeEnclosed(img, owner, autoColor, dist, maxArea, id);
    }
  }

  for (const op of ops.slice(-MAX_OPS)) {
    const x = Math.round(op.x);
    const y = Math.round(op.y);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
    const seed = y * img.width + x;
    const color = pixelColor(img, x, y);
    if (op.kind === 'remove') {
      colors.push(color);
      const id = colors.length;
      flood(img, [seed], color, toDistance(op.tolerance), op.contiguous, (p) => (owner[p] = id));
    } else {
      flood(img, [seed], color, toDistance(op.tolerance), true, (p) => (owner[p] = 0));
    }
  }
  return { owner, colors, holes };
}

/** Marks kept pixels within `radius` px of a removed pixel with that pixel's owner. */
function edgeRing(owner: Uint16Array, width: number, height: number, radius: number) {
  let ring = new Uint16Array(owner.length);
  let frontier = owner;
  for (let pass = 0; pass < radius; pass++) {
    const next = new Uint16Array(owner.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (owner[p] || ring[p]) continue;
        const id =
          (x > 0 && frontier[p - 1]) ||
          (x < width - 1 && frontier[p + 1]) ||
          (y > 0 && frontier[p - width]) ||
          (y < height - 1 && frontier[p + width]) ||
          0;
        if (id) next[p] = id;
      }
    }
    for (let p = 0; p < ring.length; p++) if (next[p]) ring[p] = next[p];
    frontier = next;
  }
  return ring;
}

/** Applies the mask to produce the cut-out RGBA image. */
export function renderCutout(img: WorkingImage, mask: Mask, settings: RemovalSettings): ImageData {
  const { width, height, data } = img;
  const out = new ImageData(new Uint8ClampedArray(data), width, height);
  const px = out.data;
  const { owner, colors } = mask;

  for (let p = 0; p < owner.length; p++) if (owner[p]) px[p * 4 + 3] = 0;

  if (settings.smoothing > 0 && colors.length) {
    const band = settings.smoothing * 1.4;
    const ring = edgeRing(owner, width, height, 2);
    for (let p = 0; p < ring.length; p++) {
      const id = ring[p];
      if (!id) continue;
      const i = p * 4;
      const bg = colors[id - 1];
      const base = toDistance(settings.tolerance);
      const d = Math.sqrt(distSq(data, i, bg));
      const alpha = Math.min(1, Math.max(0, (d - base * 0.5) / band));
      if (alpha >= 1) continue;
      px[i + 3] = Math.round(data[i + 3] * alpha);
      if (settings.cleanHalo && alpha > 0.02) {
        // Un-mix the background color: c = a·fg + (1 − a)·bg  →  fg = (c − (1 − a)·bg) / a
        px[i] = (data[i] - (1 - alpha) * bg.r) / alpha;
        px[i + 1] = (data[i + 1] - (1 - alpha) * bg.g) / alpha;
        px[i + 2] = (data[i + 2] - (1 - alpha) * bg.b) / alpha;
      }
    }
  }
  return out;
}

export function countRemoved(cutout: ImageData) {
  let removed = 0;
  for (let i = 3; i < cutout.data.length; i += 4) if (cutout.data[i] < 128) removed++;
  return removed / (cutout.width * cutout.height);
}
