/**
 * Composes a cut-out image onto its final canvas: optional recolor, trim,
 * padding, square canvas, background color, corner radius and a free
 * transform (move / resize / rotate / flip) of the subject.
 */

import type { FontGuess } from './fontMatch';
import { layerPiece, layerRest, type LayerSet } from './imageLayers';

export interface ImageTransform {
  /** Degrees, clockwise. */
  rotate: number;
  /** 1 = the subject's fitted size. */
  zoom: number;
  /** Offset of the subject's center, as a fraction of the canvas width / height. */
  x: number;
  y: number;
  flipX: boolean;
  flipY: boolean;
  /** Elements only: deleted from the image. */
  hidden?: boolean;
}

/** Text added on top of the image. Position and size are relative to the output canvas, so they survive size changes. */
export interface TextItem {
  id: string;
  text: string;
  /** Center, as a fraction of the canvas width / height. */
  x: number;
  y: number;
  /** Font size as a fraction of the canvas height. */
  size: number;
  /** Degrees, clockwise. */
  rotate: number;
  color: string;
  /** CSS font-family stack. */
  font: string;
  bold: boolean;
  italic: boolean;
  /** Fonts closest to the image lettering this text replaced or was added to, best first (if any). */
  matches?: FontGuess[];
}

export const IDENTITY_TRANSFORM: ImageTransform = { rotate: 0, zoom: 1, x: 0, y: 0, flipX: false, flipY: false };

export interface ComposeOptions {
  /** null = transparent */
  background: string | null;
  /** Recolors every visible pixel, keeping its transparency (for logos/icons). */
  tint: string | null;
  /** 'preserve' preserves white/internal icon lines & contrast; 'solid' paints all visible pixels one flat color. */
  tintMode?: 'preserve' | 'solid';
  /** Punches the subject out of the background instead of drawing it (transparent image color). */
  knockout?: boolean;
  /** Line drawing of the subject's shape (outer edge + inner color boundaries), used with `knockout`. */
  outline?: { color: string; width: number } | null;
  padding: number; // % of the longest content side
  radius: number; // 0–50 %
  trim: boolean;
  square: boolean;
  /** Longest output side in px; null keeps the working resolution. */
  size: number | null;
  transform?: ImageTransform;
  /** Separately editable elements, and each one's own transform (x / y in source px). */
  layers?: LayerSet | null;
  layerTransforms?: ReadonlyArray<ImageTransform | undefined>;
  texts?: readonly TextItem[];
}

export const isIdentity = (t: ImageTransform | undefined) =>
  !t || (t.rotate === 0 && t.zoom === 1 && t.x === 0 && t.y === 0 && !t.flipX && !t.flipY && !t.hidden);

export interface ComposeLayout {
  width: number;
  height: number;
  /** The drawn subject: its center on the output canvas and its size before rotation. */
  centerX: number;
  centerY: number;
  subjectW: number;
  subjectH: number;
  /** Radians, clockwise. */
  rotate: number;
  flipX: boolean;
  flipY: boolean;
  /** Source-image region that is drawn as the subject. */
  box: Bounds;
  layers: LayerSet | null;
  layerTransforms: ReadonlyArray<ImageTransform | undefined>;
  /** Added texts' boxes on the output canvas (center, unrotated size, rotation in radians), in drawing order. */
  texts: Array<{ id: string; x: number; y: number; w: number; h: number; rotate: number }>;
}

const LINE_HEIGHT = 1.2;

export const textFont = (t: TextItem, px: number) => `${t.italic ? 'italic ' : ''}${t.bold ? 700 : 400} ${px}px ${t.font}`;

/** Output px per source px (including the whole-image zoom). */
const unit = (layout: ComposeLayout) => layout.subjectW / layout.box.w;

/** Output canvas → subject-local px (origin at the subject center, before the whole-image rotate / flip). */
function toLocal(layout: ComposeLayout, x: number, y: number) {
  const dx = x - layout.centerX;
  const dy = y - layout.centerY;
  const cos = Math.cos(-layout.rotate);
  const sin = Math.sin(-layout.rotate);
  let lx = dx * cos - dy * sin;
  let ly = dx * sin + dy * cos;
  if (layout.flipX) lx = -lx;
  if (layout.flipY) ly = -ly;
  return { lx, ly };
}

/** Subject-local px → output canvas. */
function fromLocal(layout: ComposeLayout, lx: number, ly: number) {
  if (layout.flipX) lx = -lx;
  if (layout.flipY) ly = -ly;
  const cos = Math.cos(layout.rotate);
  const sin = Math.sin(layout.rotate);
  return { x: layout.centerX + lx * cos - ly * sin, y: layout.centerY + lx * sin + ly * cos };
}

/** Element `i`'s center in subject-local px. */
function layerCenter(layout: ComposeLayout, i: number) {
  const L = layout.layers!.layers[i];
  const t = layout.layerTransforms[i];
  const k = unit(layout);
  const { box } = layout;
  return {
    lx: (L.x + L.w / 2 - (box.x + box.w / 2) + (t?.x ?? 0)) * k,
    ly: (L.y + L.h / 2 - (box.y + box.h / 2) + (t?.y ?? 0)) * k,
  };
}

/** Maps an output point into element `i`'s source pixels (undoing its own transform). */
function throughLayer(layout: ComposeLayout, i: number, lx: number, ly: number) {
  const L = layout.layers!.layers[i];
  const t = layout.layerTransforms[i]!;
  const c = layerCenter(layout, i);
  const k = unit(layout);
  const r = (-t.rotate * Math.PI) / 180;
  const dx = lx - c.lx;
  const dy = ly - c.ly;
  let px = (dx * Math.cos(r) - dy * Math.sin(r)) / (k * t.zoom);
  let py = (dx * Math.sin(r) + dy * Math.cos(r)) / (k * t.zoom);
  if (t.flipX) px = -px;
  if (t.flipY) py = -py;
  return { x: L.x + L.w / 2 + px, y: L.y + L.h / 2 + py };
}

/** Edited elements in drawing order: bigger first, so letters stay on top of the badge they sit on. */
const editedLayers = (layout: ComposeLayout) => {
  const set = layout.layers;
  if (!set) return [];
  return layout.layerTransforms
    .flatMap((t, i) => (!isIdentity(t) && set.layers[i] ? [i] : []))
    .sort((a, b) => set.layers[b].area - set.layers[a].area);
};

/**
 * What is under an output-canvas point: the source pixel and which element it
 * belongs to (−1 = none). Moved elements are checked first, top-most last drawn.
 */
export function hitTest(layout: ComposeLayout, x: number, y: number): { x: number; y: number; layer: number } {
  const { lx, ly } = toLocal(layout, x, y);
  const set = layout.layers;
  const labelAt = (sx: number, sy: number) => {
    if (!set) return -1;
    const px = Math.floor(sx);
    const py = Math.floor(sy);
    return px >= 0 && py >= 0 && px < set.width && py < set.height ? set.labels[py * set.width + px] : -1;
  };
  const edited = editedLayers(layout);
  for (let j = edited.length - 1; j >= 0; j--) {
    if (layout.layerTransforms[edited[j]]?.hidden) continue;
    const p = throughLayer(layout, edited[j], lx, ly);
    if (labelAt(p.x, p.y) === edited[j]) return { ...p, layer: edited[j] };
  }
  const p = toBasePoint(layout, x, y);
  const layer = labelAt(p.x, p.y);
  return { ...p, layer: edited.includes(layer) ? -1 : layer };
}

/** Maps source-image px to the output canvas (the artwork itself, ignoring moved elements). */
export function fromSourcePoint(layout: ComposeLayout, sx: number, sy: number) {
  const k = unit(layout);
  return fromLocal(layout, (sx - (layout.box.x + layout.box.w / 2)) * k, (sy - (layout.box.y + layout.box.h / 2)) * k);
}

/** Maps a point on the output canvas to source-image pixels of the artwork itself, ignoring moved elements (for the heal brush). */
export function toBasePoint(layout: ComposeLayout, x: number, y: number) {
  const { lx, ly } = toLocal(layout, x, y);
  const k = unit(layout);
  return { x: layout.box.x + layout.box.w / 2 + lx / k, y: layout.box.y + layout.box.h / 2 + ly / k };
}

/**
 * Maps a point on the output canvas back to source-image pixels (for click tools).
 * A click on the spot a moved or deleted element left behind means the healed
 * artwork seen there, so it lands on the nearest pixel outside edited elements.
 */
export function toSourcePoint(layout: ComposeLayout, x: number, y: number) {
  const hit = hitTest(layout, x, y);
  const set = layout.layers;
  if (!set || hit.layer >= 0) return { x: hit.x, y: hit.y };
  const px = Math.floor(hit.x);
  const py = Math.floor(hit.y);
  if (px < 0 || py < 0 || px >= set.width || py >= set.height) return { x: hit.x, y: hit.y };
  const edited = new Set(editedLayers(layout));
  if (!edited.has(set.labels[py * set.width + px])) return { x: hit.x, y: hit.y };
  const free = (sx: number, sy: number) => {
    if (sx < 0 || sy < 0 || sx >= set.width || sy >= set.height) return false;
    const label = set.labels[sy * set.width + sx];
    return label >= 0 && !edited.has(label);
  };
  // Square rings outward; the first free pixel on the nearest ring wins.
  for (let r = 1, max = Math.max(set.width, set.height); r < max; r++) {
    for (let d = -r; d <= r; d++) {
      for (const [sx, sy] of [
        [px + d, py - r],
        [px + d, py + r],
        [px - r, py + d],
        [px + r, py + d],
      ])
        if (free(sx, sy)) return { x: sx + 0.5, y: sy + 0.5 };
    }
  }
  return { x: hit.x, y: hit.y };
}

/** Element `i`'s box on the output canvas: center, unrotated size and on-screen rotation (radians). */
export function layerBox(layout: ComposeLayout, i: number) {
  const L = layout.layers!.layers[i];
  const t = layout.layerTransforms[i];
  const c = layerCenter(layout, i);
  const { x, y } = fromLocal(layout, c.lx, c.ly);
  const k = unit(layout) * (t?.zoom ?? 1);
  const own = ((t?.rotate ?? 0) * Math.PI) / 180;
  return { x, y, w: L.w * k, h: L.h * k, rotate: layout.rotate + (layout.flipX !== layout.flipY ? -own : own) };
}

/** Converts an on-screen drag (output px) into an element offset change (source px). */
export function screenToLayerDelta(layout: ComposeLayout, dx: number, dy: number) {
  const cos = Math.cos(-layout.rotate);
  const sin = Math.sin(-layout.rotate);
  let lx = dx * cos - dy * sin;
  let ly = dx * sin + dy * cos;
  if (layout.flipX) lx = -lx;
  if (layout.flipY) ly = -ly;
  const k = unit(layout);
  return { x: lx / k, y: ly / k };
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

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (clean.length === 6) {
    return {
      r: parseInt(clean.substring(0, 2), 16),
      g: parseInt(clean.substring(2, 4), 16),
      b: parseInt(clean.substring(4, 6), 16),
    };
  }
  return null;
}

// The recolor and edge passes touch every pixel, so their results are cached
// per cut-out: dragging / rotating the subject then only re-draws.
const sourceCache = new WeakMap<ImageData, { key: string; canvas: HTMLCanvasElement }>();
const edgeCache = new WeakMap<ImageData, HTMLCanvasElement>();

function preparedSource(cutout: ImageData, options: ComposeOptions): HTMLCanvasElement {
  const tint = options.knockout ? null : options.tint;
  const key = `${tint}|${options.tintMode ?? 'preserve'}`;
  const cached = sourceCache.get(cutout);
  if (cached?.key === key) return cached.canvas;
  const source = toCanvas(cutout);
  if (tint) {
    const tctx = source.getContext('2d')!;
    if (options.tintMode === 'solid') {
      tctx.globalCompositeOperation = 'source-in';
      tctx.fillStyle = tint;
      tctx.fillRect(0, 0, source.width, source.height);
    } else {
      // Preserve detail mode: tint while maintaining contrast & white inner details
      const imgData = tctx.getImageData(0, 0, source.width, source.height);
      const data = imgData.data;
      const rgb = hexToRgb(tint);
      if (rgb) {
        const { r: tr, g: tg, b: tb } = rgb;
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 8) continue;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          if (lum > 0.88) {
            // Keep white/bright icon lines clean & clear
            const factor = (lum - 0.88) / 0.12;
            data[i] = Math.round(tr * (1 - factor) + 255 * factor);
            data[i + 1] = Math.round(tg * (1 - factor) + 255 * factor);
            data[i + 2] = Math.round(tb * (1 - factor) + 255 * factor);
          } else {
            // Tint non-white regions while preserving lightness variation
            const scale = lum * 0.7 + 0.3;
            data[i] = Math.round(tr * scale);
            data[i + 1] = Math.round(tg * scale);
            data[i + 2] = Math.round(tb * scale);
          }
        }
        tctx.putImageData(imgData, 0, 0);
      }
    }
  }
  sourceCache.set(cutout, { key, canvas: source });
  return source;
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

  const cornerRadius = (Math.min(width, height) * Math.min(options.radius, 50)) / 100;
  if (options.background) {
    ctx.fillStyle = options.background;
    roundedRect(ctx, width, height, cornerRadius);
  }

  const t = options.transform ?? IDENTITY_TRANSFORM;
  const layout: ComposeLayout = {
    width,
    height,
    centerX: width / 2 + t.x * width,
    centerY: height / 2 + t.y * height,
    subjectW: box.w * scale * t.zoom,
    subjectH: box.h * scale * t.zoom,
    rotate: (t.rotate * Math.PI) / 180,
    flipX: t.flipX,
    flipY: t.flipY,
    box,
    layers: options.layers ?? null,
    layerTransforms: options.layerTransforms ?? [],
    texts: [],
  };
  const place = () => {
    ctx.translate(layout.centerX, layout.centerY);
    ctx.rotate(layout.rotate);
    ctx.scale(t.flipX ? -1 : 1, t.flipY ? -1 : 1);
  };

  // Clip the artwork to the rounded background so corners stay clean.
  const clip = options.background && options.radius > 0;
  if (clip) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, cornerRadius);
    ctx.clip();
  }
  const { subjectW: w, subjectH: h } = layout;
  const k = unit(layout);
  const edited = editedLayers(layout);
  type Draw = (img: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) => void;
  /** Draws a full-size source: in one go, or — once elements have been edited — the unmoved rest plus each edited element. */
  // `heal` fills the spot an element leaves behind with the color around it (only for the artwork itself).
  const drawSubject = (src: HTMLCanvasElement, draw: Draw, heal: boolean) => {
    ctx.save();
    place();
    if (!edited.length || !layout.layers) {
      draw(src, box.x, box.y, box.w, box.h, -w / 2, -h / 2, w, h);
    } else {
      const set = layout.layers;
      draw(layerRest(src, set, edited, heal), box.x, box.y, box.w, box.h, -w / 2, -h / 2, w, h);
      for (const i of edited) {
        const L = set.layers[i];
        const lt = layout.layerTransforms[i]!;
        if (lt.hidden) continue;
        const c = layerCenter(layout, i);
        ctx.save();
        ctx.translate(c.lx, c.ly);
        ctx.rotate((lt.rotate * Math.PI) / 180);
        ctx.scale((lt.flipX ? -1 : 1) * lt.zoom, (lt.flipY ? -1 : 1) * lt.zoom);
        draw(layerPiece(src, set, i), 0, 0, L.w, L.h, (-L.w * k) / 2, (-L.h * k) / 2, L.w * k, L.h * k);
        ctx.restore();
      }
    }
    ctx.restore();
  };

  drawSubject(preparedSource(cutout, options), (img, ...args) => {
    if (options.knockout) ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(img, ...args);
    ctx.globalCompositeOperation = 'source-over';
  }, true);
  if (options.knockout && options.outline && options.outline.width > 0) {
    const radius = Math.max(0.5, (options.outline.width * Math.max(width, height)) / 1000);
    const color = options.outline.color;
    drawSubject(edgeMap(cutout), (img, sx, sy, sw, sh, dx, dy, dw, dh) => {
      const lines = outlineCanvas(img, sx, sy, sw, sh, dw, dh, radius, color);
      ctx.drawImage(lines, dx - (lines.width - dw) / 2, dy - (lines.height - dh) / 2);
    }, false);
  }

  for (const item of options.texts ?? []) {
    if (!item.text.trim()) continue;
    const px = Math.max(1, item.size * height);
    const lines = item.text.split('\n');
    ctx.save();
    ctx.font = textFont(item, px);
    const tw = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
    const th = lines.length * px * LINE_HEIGHT;
    const x = item.x * width;
    const y = item.y * height;
    const rotate = (item.rotate * Math.PI) / 180;
    ctx.translate(x, y);
    ctx.rotate(rotate);
    ctx.fillStyle = item.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, j) => ctx.fillText(l, 0, (j - (lines.length - 1) / 2) * px * LINE_HEIGHT));
    ctx.restore();
    layout.texts.push({ id: item.id, x, y, w: tw, h: th, rotate });
  }
  if (clip) ctx.restore();

  return { canvas: target, layout };
}

/** Minimum RGB distance between neighbouring opaque pixels that counts as an inner edge. */
const INNER_EDGE = 48;

/** Full-size 1px edge map of the cut-out: the outer silhouette plus boundaries between differently colored regions. */
function edgeMap(cutout: ImageData): HTMLCanvasElement {
  const cached = edgeCache.get(cutout);
  if (cached) return cached;
  const x0 = 0;
  const y0 = 0;
  const w = cutout.width;
  const h = cutout.height;

  const { width, data } = cutout;
  const out = new ImageData(w, h);
  const opaque = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < cutout.width && y < cutout.height && data[(y * width + x) * 4 + 3] >= 128;
  const differs = (i: number, j: number) => {
    const dr = data[i] - data[j];
    const dg = data[i + 1] - data[j + 1];
    const db = data[i + 2] - data[j + 2];
    return dr * dr + dg * dg + db * db > INNER_EDGE * INNER_EDGE;
  };
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (!opaque(x, y)) continue;
      const i = (y * width + x) * 4;
      const edge =
        !opaque(x - 1, y) ||
        !opaque(x + 1, y) ||
        !opaque(x, y - 1) ||
        !opaque(x, y + 1) ||
        differs(i, i + 4) ||
        (y + 1 < cutout.height && differs(i, i + width * 4));
      if (edge) out.data[((y - y0) * w + (x - x0)) * 4 + 3] = 255;
    }
  }
  const canvas = toCanvas(out);
  edgeCache.set(cutout, canvas);
  return canvas;
}

/** Draws the `s*` region of an edge map at `w`×`h`, thickened to `radius` px, centered in a canvas with room for the stroke. */
function outlineCanvas(
  edges: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  w: number,
  h: number,
  radius: number,
  color: string,
): HTMLCanvasElement {
  const pad = Math.ceil(radius) + 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w + pad * 2));
  canvas.height = Math.max(1, Math.ceil(h + pad * 2));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const x = (canvas.width - w) / 2;
  const y = (canvas.height - h) / 2;
  // Stamp the edge map around concentric circles to thicken the lines evenly.
  ctx.drawImage(edges, sx, sy, sw, sh, x, y, w, h);
  for (let r = Math.min(1, radius); r <= radius + 1e-6; r += Math.max(0.75, radius / 4)) {
    const steps = Math.max(8, Math.ceil(2 * Math.PI * r));
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      ctx.drawImage(edges, sx, sy, sw, sh, x + Math.cos(a) * r, y + Math.sin(a) * r, w, h);
    }
  }
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality),
  );
}

export type Align = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Offset patch (source px) that lines element `i` up with an edge or the center of the canvas. */
export function alignLayer(layout: ComposeLayout, i: number, align: Align): Partial<ImageTransform> {
  const L = layout.layers!.layers[i];
  const t = layout.layerTransforms[i];
  const k = unit(layout);
  const zoom = t?.zoom ?? 1;
  const r = ((t?.rotate ?? 0) * Math.PI) / 180;
  // Half the element's rotated extent, and the canvas frame, in subject-local px.
  const ex = ((Math.abs(L.w * Math.cos(r)) + Math.abs(L.h * Math.sin(r))) / 2) * k * zoom;
  const ey = ((Math.abs(L.w * Math.sin(r)) + Math.abs(L.h * Math.cos(r))) / 2) * k * zoom;
  const frame = toLocal(layout, layout.width / 2, layout.height / 2);
  const hw = layout.width / 2;
  const hh = layout.height / 2;
  const baseX = L.x + L.w / 2 - (layout.box.x + layout.box.w / 2);
  const baseY = L.y + L.h / 2 - (layout.box.y + layout.box.h / 2);
  switch (align) {
    case 'left':
      return { x: (frame.lx - hw + ex) / k - baseX };
    case 'center':
      return { x: frame.lx / k - baseX };
    case 'right':
      return { x: (frame.lx + hw - ex) / k - baseX };
    case 'top':
      return { y: (frame.ly - hh + ey) / k - baseY };
    case 'middle':
      return { y: frame.ly / k - baseY };
    case 'bottom':
      return { y: (frame.ly + hh - ey) / k - baseY };
  }
}
