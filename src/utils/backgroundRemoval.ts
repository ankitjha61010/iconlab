/**
 * Client-side background removal for images with fairly uniform backgrounds
 * (logos, icons, product shots, screenshots). Nothing is uploaded anywhere.
 *
 * The mask is rebuilt by replaying operations:
 * 1. an automatic pass that flood-fills from the image border using the
 *    detected background color, then
 * 2. manual "remove"/"restore" clicks (magic-wand style), in order.
 *    ("fill" clicks and heal-brush strokes change the cut-out afterwards; see applyFills.)
 *
 * Edge pixels next to removed areas get partial alpha based on how close they
 * are to the removed color, and that color is un-mixed from them so no halo
 * of the old background is left behind.
 */

import { HEAL_REACH, healPixels } from './heal';

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
  | { kind: 'restore'; x: number; y: number; tolerance: number }
  /** Paints a visible region a new color (applied to the cut-out, not the mask). */
  | { kind: 'fill'; x: number; y: number; tolerance: number; color: RGB }
  /** Heal brush: paints over a stroke (x, y pairs, source px) with the background around it. */
  | { kind: 'heal'; points: number[]; radius: number }
  /**
   * Recolors exactly one part of the image. Its pixels are kept (runs of
   * [row, start, length] within the box at x, y), so later edits that change
   * how the image splits into parts don't move the fill.
   */
  | { kind: 'paint'; x: number; y: number; w: number; h: number; runs: number[]; color: RGB };

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
  /** Automatically remove container/badge shapes surrounding inner icon elements. */
  removeContainer: boolean;
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

export function estimateContainerColor(img: WorkingImage, owner: Uint16Array): { color: RGB; seeds: number[] } | null {
  const { width, height, data } = img;
  const n = width * height;
  const seeds: number[] = [];
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();

  for (let p = 0; p < n; p++) {
    if (owner[p] !== 0) continue;
    const x = p % width;
    const y = Math.floor(p / width);
    // Check if this kept pixel touches a removed pixel or border
    const touchesEdge =
      x === 0 ||
      x === width - 1 ||
      y === 0 ||
      y === height - 1 ||
      owner[p - 1] > 0 ||
      owner[p + 1] > 0 ||
      owner[p - width] > 0 ||
      owner[p + width] > 0;
    if (touchesEdge) {
      seeds.push(p);
      const i = p * 4;
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      const b = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      b.n++;
      b.r += data[i];
      b.g += data[i + 1];
      b.b += data[i + 2];
      buckets.set(key, b);
    }
  }

  if (seeds.length === 0) return null;
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const b of buckets.values()) if (!best || b.n > best.n) best = b;
  if (!best || best.n < seeds.length * 0.15) return null;
  return { color: { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n }, seeds };
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

  if (settings.removeContainer) {
    const container = estimateContainerColor(img, owner);
    if (container) {
      colors.push(container.color);
      const id = colors.length;
      const dist = toDistance(settings.tolerance);
      flood(img, container.seeds, container.color, dist, true, (p) => (owner[p] = id));
    }
  }

  for (const op of ops.slice(-MAX_OPS)) {
    if (op.kind !== 'remove' && op.kind !== 'restore') continue;
    const x = Math.round(op.x);
    const y = Math.round(op.y);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
    const seed = y * img.width + x;
    const color = pixelColor(img, x, y);
    if (op.kind === 'remove') {
      colors.push(color);
      const id = colors.length;
      flood(img, [seed], color, toDistance(op.tolerance), op.contiguous, (p) => (owner[p] = id));
    } else if (op.kind === 'restore') {
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

/**
 * Replays "fill" and "heal" ops on the cut-out, in order. A fill flood-fills
 * the clicked region (by the colors as they are now, so a healed spot fills
 * with what's around it; staying inside visible pixels) with the chosen color.
 * Anti-aliased pixels on the region's border are blended so edges stay smooth.
 * A heal stroke is painted over with the background around it.
 */
export function applyFills(cutout: ImageData, img: WorkingImage, ops: RemovalOp[]) {
  const { width, height } = img;
  const px = cutout.data;
  for (const op of ops.slice(-MAX_OPS)) {
    if (op.kind === 'heal') {
      healStroke(cutout, op.points, op.radius);
      continue;
    }
    if (op.kind === 'paint') {
      paintPart(cutout, op);
      continue;
    }
    if (op.kind !== 'fill') continue;
    const x = Math.round(op.x);
    const y = Math.round(op.y);
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const seed = y * width + x;
    if (px[seed * 4 + 3] < TRANSPARENT) continue;
    const target = { r: px[seed * 4], g: px[seed * 4 + 1], b: px[seed * 4 + 2] };
    const dist = toDistance(op.tolerance);
    const limit = dist * dist;
    const filled = new Uint8Array(width * height);
    const stack = new Int32Array(width * height);
    let top = 0;
    filled[seed] = 1;
    stack[top++] = seed;
    while (top > 0) {
      const p = stack[--top];
      const i = p * 4;
      px[i] = op.color.r;
      px[i + 1] = op.color.g;
      px[i + 2] = op.color.b;
      const cx = p % width;
      const push = (q: number) => {
        if (filled[q] || px[q * 4 + 3] < TRANSPARENT || distSq(px, q * 4, target) > limit) return;
        filled[q] = 1;
        stack[top++] = q;
      };
      if (cx > 0) push(p - 1);
      if (cx < width - 1) push(p + 1);
      if (p >= width) push(p - width);
      if (p < width * (height - 1)) push(p + width);
    }
    // Blend the 1px border by how close each pixel is to the filled color.
    for (let p = 0; p < filled.length; p++) {
      if (filled[p] || px[p * 4 + 3] < TRANSPARENT) continue;
      const cx = p % width;
      const touches =
        (cx > 0 && filled[p - 1]) || (cx < width - 1 && filled[p + 1]) || (p >= width && filled[p - width]) || (p < width * (height - 1) && filled[p + width]);
      if (!touches) continue;
      const i = p * 4;
      const t = Math.max(0, 1 - Math.sqrt(distSq(px, i, target)) / (dist * 3));
      px[i] += (op.color.r - px[i]) * t;
      px[i + 1] += (op.color.g - px[i + 1]) * t;
      px[i + 2] += (op.color.b - px[i + 2]) * t;
    }
  }
}

/**
 * Recolors a part. Its anti-aliased rim is a mix of the part's color and
 * what's next to it, so each pixel gets the color change in proportion to how
 * close it is to the part's own color: the edge stays smooth.
 */
function paintPart(cutout: ImageData, op: Extract<RemovalOp, { kind: 'paint' }>) {
  const { width, height, data } = cutout;
  const pixels: number[] = [];
  for (let k = 0; k + 2 < op.runs.length; k += 3) {
    const y = op.y + op.runs[k];
    if (y < 0 || y >= height) continue;
    for (let x = op.x + op.runs[k + 1], end = x + op.runs[k + 2]; x < end; x++) if (x >= 0 && x < width) pixels.push(y * width + x);
  }
  const solid = pixels.filter((p) => data[p * 4 + 3] >= 200);
  if (!solid.length) return;
  // The part's own color: the median of its pixels (its rim is the minority).
  const own = [0, 1, 2].map((k) => {
    const v = solid.map((p) => data[p * 4 + k]).sort((a, b) => a - b);
    return v[v.length >> 1];
  });
  const dist = (p: number) => Math.hypot(data[p * 4] - own[0], data[p * 4 + 1] - own[1], data[p * 4 + 2] - own[2]);
  // How far the rim strays from the part's color (the furthest few percent).
  const far = solid.map(dist).sort((a, b) => a - b)[Math.floor(solid.length * 0.97)] ?? 0;
  const reach = Math.max(60, far * 1.25);
  const shift = [op.color.r - own[0], op.color.g - own[1], op.color.b - own[2]];
  for (const p of pixels) {
    const t = Math.max(0, 1 - dist(p) / reach);
    for (let k = 0; k < 3; k++) data[p * 4 + k] += shift[k] * t;
  }
}

/** Paints over a brush stroke with the background around it. Transparent parts of the stroke stay transparent. */
function healStroke(cutout: ImageData, points: number[], radius: number) {
  const { width, height, data } = cutout;
  if (points.length < 2 || radius <= 0) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < points.length; k += 2) {
    minX = Math.min(minX, points[k]);
    maxX = Math.max(maxX, points[k]);
    minY = Math.min(minY, points[k + 1]);
    maxY = Math.max(maxY, points[k + 1]);
  }
  const pad = radius + HEAL_REACH + 1;
  const x0 = Math.max(0, Math.floor(minX - pad));
  const y0 = Math.max(0, Math.floor(minY - pad));
  const x1 = Math.min(width, Math.ceil(maxX + pad));
  const y1 = Math.min(height, Math.ceil(maxY + pad));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return;

  // The stroke: every pixel within `radius` of one of its segments.
  const inStroke = new Uint8Array(w * h);
  const r2 = radius * radius;
  for (let k = 0; k < points.length; k += 2) {
    const ax = points[k];
    const ay = points[k + 1];
    const bx = k + 3 < points.length ? points[k + 2] : ax;
    const by = k + 3 < points.length ? points[k + 3] : ay;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const sx0 = Math.max(x0, Math.floor(Math.min(ax, bx) - radius));
    const sx1 = Math.min(x1 - 1, Math.ceil(Math.max(ax, bx) + radius));
    const sy0 = Math.max(y0, Math.floor(Math.min(ay, by) - radius));
    const sy1 = Math.min(y1 - 1, Math.ceil(Math.max(ay, by) + radius));
    for (let y = sy0; y <= sy1; y++) {
      for (let x = sx0; x <= sx1; x++) {
        const cx = x + 0.5;
        const cy = y + 0.5;
        const t = len2 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / len2)) : 0;
        const ex = cx - (ax + t * dx);
        const ey = cy - (ay + t * dy);
        if (ex * ex + ey * ey <= r2) inStroke[(y - y0) * w + (x - x0)] = 1;
      }
    }
  }

  const box = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) box.set(data.subarray(((y0 + y) * width + x0) * 4, ((y0 + y) * width + x1) * 4), y * w * 4);
  const state = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const a = box[p * 4 + 3];
    if (inStroke[p]) state[p] = a >= TRANSPARENT ? 2 : 0;
    else if (a >= 200) state[p] = 1;
  }
  healPixels(box, w, h, state);
  for (let y = 0; y < h; y++) data.set(box.subarray(y * w * 4, (y + 1) * w * 4), ((y0 + y) * width + x0) * 4);
}

export function countRemoved(cutout: ImageData) {
  let removed = 0;
  for (let i = 3; i < cutout.data.length; i += 4) if (cutout.data[i] < 128) removed++;
  return removed / (cutout.width * cutout.height);
}
