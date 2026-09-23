import type { ImageTransform } from './imageCompose';

/**
 * Splits a cut-out into separately editable elements (a line of text, a logo
 * mark, …) so each can be moved / resized / rotated on its own.
 *
 * Visible pixels are grouped into connected shapes, then shapes whose boxes
 * are close together are merged — letters of a word or line become one
 * element, while lines separated by a clear gap stay apart. Horizontal gaps
 * may be wider than vertical ones (and grow with the height of parts sitting
 * on the same line), which matches how text is laid out.
 */

export interface ImageLayer {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Number of visible pixels. */
  area: number;
  /** A pixel index inside the element, used to re-identify it after the cut-out changes. */
  anchor: number;
  /** Big enough to show a selection box for. */
  selectable: boolean;
  /** Number of separate shapes (letters) it is made of (1 for pieces of a split element). */
  parts: number;
  /** Set on the letters of a split-up element: the split anchor that broke it apart. */
  splitAnchor: number | null;
  /**
   * The element this one sits inside (e.g. the white fill inside a letter, a
   * letter printed on a badge). It follows its parent when that is moved or
   * deleted, unless it has been edited on its own.
   */
  parent: number | null;
}

export interface LayerSet {
  width: number;
  height: number;
  /** Element index per pixel, −1 for (nearly) transparent pixels. */
  labels: Int32Array;
  layers: ImageLayer[];
}

const VISIBLE = 8;
/** Only the largest elements get selection boxes, so noisy images stay usable. */
const MAX_SELECTABLE = 60;

interface Shape {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  area: number;
  anchor: number;
}

/**
 * `gap` is the merge distance in % of the image's longest side (0 = every
 * separate shape is its own element). Elements containing one of the
 * `splitAnchors` pixels are broken back up into their separate shapes (letters).
 */
export function segmentLayers(image: ImageData, gap: number, splitAnchors: readonly number[] = []): LayerSet {
  const { width, height, data } = image;
  const n = width * height;
  const shapeOf = new Int32Array(n).fill(-1);
  const shapes: Shape[] = [];
  const stack = new Int32Array(n);

  // 1. Connected shapes (8-connected, so diagonal strokes stay whole).
  for (let start = 0; start < n; start++) {
    if (shapeOf[start] >= 0 || data[start * 4 + 3] <= VISIBLE) continue;
    const id = shapes.length;
    const s: Shape = { x0: width, y0: height, x1: -1, y1: -1, area: 0, anchor: start };
    let top = 0;
    shapeOf[start] = id;
    stack[top++] = start;
    while (top > 0) {
      const p = stack[--top];
      const x = p % width;
      const y = (p - x) / width;
      s.area++;
      if (x < s.x0) s.x0 = x;
      if (x > s.x1) s.x1 = x;
      if (y < s.y0) s.y0 = y;
      if (y > s.y1) s.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || (dx === 0 && dy === 0)) continue;
          const q = yy * width + xx;
          if (shapeOf[q] < 0 && data[q * 4 + 3] > VISIBLE) {
            shapeOf[q] = id;
            stack[top++] = q;
          }
        }
      }
    }
    shapes.push(s);
  }

  // 2. Merge shapes whose boxes are within the gap (union-find).
  const parent = shapes.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const longest = Math.max(width, height);
  const gx = (longest * gap) / 100;
  const gy = Math.max(1, gx * 0.4);
  // Side by side on the same line (like words), parts may be further apart:
  // up to a share of their height, since word spacing grows with the font size.
  const lineK = 0.5 * Math.min(1, gap / 3);
  const order = shapes.map((_, i) => i).sort((a, b) => shapes[a].x0 - shapes[b].x0);
  for (let a = 0; a < order.length; a++) {
    const A = shapes[order[a]];
    const hA = A.y1 - A.y0 + 1;
    for (let b = a + 1; b < order.length; b++) {
      const B = shapes[order[b]];
      const dx = B.x0 - A.x1;
      if (dx > gx + lineK * hA) break; // sorted by x0: nothing further right can be close
      const hB = B.y1 - B.y0 + 1;
      const overlapY = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0) + 1;
      const sameLine = overlapY >= 0.5 * Math.min(hA, hB);
      const near = dx <= gx || (sameLine && dx <= gx + lineK * Math.min(hA, hB));
      if (near && B.y0 - A.y1 <= gy && A.y0 - B.y1 <= gy) parent[find(order[a])] = find(order[b]);
    }
  }

  // 3. Split groups are broken up by color as well as by shape, so white
  //    lettering printed on a colored badge comes apart from the badge.
  const rootOf = Int32Array.from(shapes, (_, i) => find(i));
  const splitRoot = new Map<number, number>();
  for (const a of splitAnchors) if (a >= 0 && a < n && shapeOf[a] >= 0) splitRoot.set(rootOf[shapeOf[a]], a);
  const region = splitRoot.size ? colorRegions(image, shapeOf, rootOf, splitRoot) : null;

  // 4. Build elements and the per-pixel label map.
  //    Keys: group root (≥ 0), or for split groups −1 − region (−1 − regions − shape when a pixel has no region).
  const regionCount = region ? region.count : 0;
  const keyAt = (p: number) => {
    const root = rootOf[shapeOf[p]];
    if (!splitRoot.has(root)) return root;
    const r = region!.of[p];
    return r >= 0 ? -1 - r : -1 - regionCount - shapeOf[p];
  };
  const indexOf = new Map<number, number>();
  const layers: ImageLayer[] = [];
  const x1s: number[] = [];
  const y1s: number[] = [];
  const labels = new Int32Array(n).fill(-1);
  for (let p = 0; p < n; p++) {
    if (shapeOf[p] < 0) continue;
    const key = keyAt(p);
    let li = indexOf.get(key);
    const x = p % width;
    const y = (p - x) / width;
    if (li === undefined) {
      li = layers.length;
      indexOf.set(key, li);
      const root = rootOf[shapeOf[p]];
      layers.push({ x, y, w: 1, h: 1, area: 0, anchor: p, selectable: false, parts: 1, splitAnchor: splitRoot.get(root) ?? null, parent: null });
      x1s.push(x);
      y1s.push(y);
    }
    const L = layers[li];
    labels[p] = li;
    L.area++;
    if (x < L.x) L.x = x;
    if (x > x1s[li]) x1s[li] = x;
    if (y > y1s[li]) y1s[li] = y;
  }
  layers.forEach((L, i) => {
    L.w = x1s[i] - L.x + 1;
    L.h = y1s[i] - L.y + 1;
  });
  // Whole groups: anchor on their biggest shape (stable when small bits change) and count their shapes.
  const biggest = new Map<number, number>();
  shapes.forEach((sh, i) => {
    const root = rootOf[i];
    if (splitRoot.has(root)) return;
    const li = indexOf.get(root)!;
    const L = layers[li];
    L.parts = biggest.has(li) ? L.parts + 1 : 1;
    if (sh.area > (biggest.get(li) ?? 0)) {
      biggest.set(li, sh.area);
      L.anchor = sh.anchor;
    }
  });

  findParents(labels, width, height, layers);

  const minArea = Math.max(12, n * 0.0002);
  layers
    .map((L, i) => [L.area, i] as const)
    .filter(([area]) => area >= minArea)
    .sort((a, b) => b[0] - a[0])
    .slice(0, MAX_SELECTABLE)
    .forEach(([, i]) => (layers[i].selectable = true));

  return { width, height, labels, layers };
}

/** Share of an element's surroundings that must belong to one bigger element for it to count as sitting inside it. */
const ENCLOSED = 0.6;

/**
 * Looks just outside each element's edge (2 px out, past the anti-aliased
 * seam). If most of what's there is one bigger element, that is its parent.
 */
function findParents(labels: Int32Array, width: number, height: number, layers: ImageLayer[]) {
  const around = layers.map(() => new Map<number, number>());
  const total = new Int32Array(layers.length);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const li = labels[y * width + x];
      if (li < 0) continue;
      for (const [dx, dy] of dirs) {
        const x1 = x + dx;
        const y1 = y + dy;
        if (x1 >= 0 && y1 >= 0 && x1 < width && y1 < height && labels[y1 * width + x1] === li) continue; // not an edge this way
        const x2 = x + dx * 2;
        const y2 = y + dy * 2;
        const other = x2 >= 0 && y2 >= 0 && x2 < width && y2 < height ? labels[y2 * width + x2] : -1;
        if (other === li) continue;
        total[li]++;
        if (other >= 0) around[li].set(other, (around[li].get(other) ?? 0) + 1);
      }
    }
  }
  layers.forEach((L, i) => {
    let best = -1;
    let count = 0;
    for (const [j, c] of around[i]) if (c > count) [best, count] = [j, c];
    // A parent is always bigger, so parent chains can't loop.
    if (best >= 0 && total[i] && count / total[i] >= ENCLOSED && layers[best].area > L.area) L.parent = best;
  });
}

/**
 * Effective per-element transforms: elements without their own edit follow
 * their parent, pivoting around the parent's center like one object.
 */
export function inheritTransforms(set: LayerSet, own: ReadonlyArray<ImageTransform | undefined>): Array<ImageTransform | undefined> {
  const out: Array<ImageTransform | undefined> = [];
  const resolve = (i: number): ImageTransform | undefined => {
    if (i in out) return out[i];
    const L = set.layers[i];
    let t = own[i];
    if (!t && L.parent !== null) {
      const pt = resolve(L.parent);
      if (pt) {
        const P = set.layers[L.parent];
        // Offset from the parent's center, flipped / rotated / scaled with it.
        let dx = L.x + L.w / 2 - (P.x + P.w / 2);
        let dy = L.y + L.h / 2 - (P.y + P.h / 2);
        if (pt.flipX) dx = -dx;
        if (pt.flipY) dy = -dy;
        const r = (pt.rotate * Math.PI) / 180;
        const rx = (dx * Math.cos(r) - dy * Math.sin(r)) * pt.zoom;
        const ry = (dx * Math.sin(r) + dy * Math.cos(r)) * pt.zoom;
        t = { ...pt, x: pt.x + rx - dx, y: pt.y + ry - dy };
      }
    }
    out[i] = t;
    return t;
  };
  set.layers.forEach((_, i) => resolve(i));
  return out;
}

/** RGB distance from a region's first pixel that still counts as the same color. */
const SAME_COLOR = 60;

/**
 * Same-color regions inside split groups. Anti-aliased seams between colors
 * form tiny fragments; those (and faint edge pixels) are handed to the
 * neighboring region they touch, so every visible pixel ends up in one.
 */
function colorRegions(image: ImageData, shapeOf: Int32Array, rootOf: Int32Array, splitRoot: Map<number, number>) {
  const { width, data } = image;
  const n = data.length / 4;
  const of = new Int32Array(n).fill(-1);
  const inSplit = (p: number) => shapeOf[p] >= 0 && splitRoot.has(rootOf[shapeOf[p]]);
  const sameGroup = (p: number, q: number) => shapeOf[q] >= 0 && rootOf[shapeOf[q]] === rootOf[shapeOf[p]];
  const stack = new Int32Array(n);
  const members: number[] = [];
  const minFragment = Math.max(24, n * 0.00005);
  let count = 0;

  for (let start = 0; start < n; start++) {
    if (of[start] >= 0 || data[start * 4 + 3] < 128 || !inSplit(start)) continue;
    const i0 = start * 4;
    const r0 = data[i0];
    const g0 = data[i0 + 1];
    const b0 = data[i0 + 2];
    const matches = (q: number) => {
      const i = q * 4;
      const dr = data[i] - r0;
      const dg = data[i + 1] - g0;
      const db = data[i + 2] - b0;
      return data[i + 3] >= 128 && dr * dr + dg * dg + db * db <= SAME_COLOR * SAME_COLOR;
    };
    const id = count++;
    members.length = 0;
    let top = 0;
    of[start] = id;
    stack[top++] = start;
    while (top > 0) {
      const p = stack[--top];
      members.push(p);
      const x = p % width;
      const push = (q: number) => {
        if (of[q] < 0 && sameGroup(p, q) && matches(q)) {
          of[q] = id;
          stack[top++] = q;
        }
      };
      if (x > 0) push(p - 1);
      if (x < width - 1) push(p + 1);
      if (p >= width) push(p - width);
      if (p < n - width) push(p + width);
    }
    // Too small to be a letter or part: dissolve it into its neighbors below.
    if (members.length < minFragment) for (const p of members) of[p] = -2;
  }

  // Grow the regions into dissolved fragments and faint pixels of the same group.
  let frontier: number[] = [];
  for (let p = 0; p < n; p++) if (of[p] >= 0) frontier.push(p);
  while (frontier.length) {
    const next: number[] = [];
    for (const p of frontier) {
      const x = p % width;
      const grow = (q: number) => {
        if (of[q] < 0 && sameGroup(p, q)) {
          of[q] = of[p];
          next.push(q);
        }
      };
      if (x > 0) grow(p - 1);
      if (x < width - 1) grow(p + 1);
      if (p >= width) grow(p - width);
      if (p < n - width) grow(p + width);
    }
    frontier = next;
  }
  return { of, count };
}

// ---------------------------------------------------------------------------
// Element pixels as canvases (cached per source canvas)
// ---------------------------------------------------------------------------

const maskCache = new WeakMap<LayerSet, Map<number, HTMLCanvasElement>>();
const pieceCache = new WeakMap<HTMLCanvasElement, WeakMap<LayerSet, Map<number, HTMLCanvasElement>>>();
const restCache = new WeakMap<HTMLCanvasElement, { set: LayerSet; key: string; canvas: HTMLCanvasElement }>();

function layerMask(set: LayerSet, i: number): HTMLCanvasElement {
  let byIndex = maskCache.get(set);
  if (!byIndex) maskCache.set(set, (byIndex = new Map()));
  const cached = byIndex.get(i);
  if (cached) return cached;
  const L = set.layers[i];
  const img = new ImageData(L.w, L.h);
  for (let y = 0; y < L.h; y++) {
    const row = (L.y + y) * set.width + L.x;
    for (let x = 0; x < L.w; x++) if (set.labels[row + x] === i) img.data[(y * L.w + x) * 4 + 3] = 255;
  }
  const canvas = document.createElement('canvas');
  canvas.width = L.w;
  canvas.height = L.h;
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  byIndex.set(i, canvas);
  return canvas;
}

/** Just element `i`'s pixels of `source` (a full-size canvas), cropped to its box. */
export function layerPiece(source: HTMLCanvasElement, set: LayerSet, i: number): HTMLCanvasElement {
  let bySet = pieceCache.get(source);
  if (!bySet) pieceCache.set(source, (bySet = new WeakMap()));
  let byIndex = bySet.get(set);
  if (!byIndex) bySet.set(set, (byIndex = new Map()));
  const cached = byIndex.get(i);
  if (cached) return cached;
  const L = set.layers[i];
  const canvas = document.createElement('canvas');
  canvas.width = L.w;
  canvas.height = L.h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, L.x, L.y, L.w, L.h, 0, 0, L.w, L.h);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(layerMask(set, i), 0, 0);
  byIndex.set(i, canvas);
  return canvas;
}

export function layerRest(source: HTMLCanvasElement, set: LayerSet, removed: number[], heal = false): HTMLCanvasElement {
  const key = `${removed.join(',')}|${heal}`;
  const cached = restCache.get(source);
  if (cached && cached.set === set && cached.key === key) return cached.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: heal })!;
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  for (const i of removed) {
    const L = set.layers[i];
    ctx.drawImage(layerMask(set, i), L.x, L.y);
  }
  ctx.globalCompositeOperation = 'source-over';
  if (heal) for (const i of removed) inpaint(ctx, set, i);
  restCache.set(source, { set, key, canvas });
  return canvas;
}

/** How far past an element's edge its blended seam is repainted too. */
const SEAM = 2;

/**
 * Fills the spot element `i` left behind — if it sat on top of other artwork —
 * by growing the surrounding pixels inward, ring by ring (so gradients and
 * spots that straddle two colors come out right). Its blended edge is
 * repainted too, so no ghost outline stays. Spots mostly surrounded by
 * transparency are left empty.
 */
function inpaint(ctx: CanvasRenderingContext2D, set: LayerSet, i: number) {
  const L = set.layers[i];
  const pad = SEAM + 2;
  const x0 = Math.max(0, L.x - pad);
  const y0 = Math.max(0, L.y - pad);
  const w = Math.min(set.width, L.x + L.w + pad) - x0;
  const h = Math.min(set.height, L.y + L.h + pad) - y0;
  const img = ctx.getImageData(x0, y0, w, h);
  const d = img.data;
  const own = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) own[y * w + x] = set.labels[(y0 + y) * set.width + x0 + x] === i ? 1 : 0;

  // Enclosed? Look 3 px out from the element's edge and require mostly solid artwork there.
  let edge = 0;
  let solid = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!own[y * w + x]) continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const x1 = x + dx;
        const y1 = y + dy;
        if (x1 >= 0 && y1 >= 0 && x1 < w && y1 < h && own[y1 * w + x1]) continue;
        edge++;
        const x3 = x + dx * 3;
        const y3 = y + dy * 3;
        if (x3 >= 0 && y3 >= 0 && x3 < w && y3 < h && !own[y3 * w + x3] && d[(y3 * w + x3) * 4 + 3] >= 200) solid++;
      }
    }
  }
  if (!edge || solid / edge < ENCLOSED) return;

  // 0 = leave, 1 = known color, 2 = to fill. The spot, plus opaque seam pixels within SEAM px of it.
  const state = new Uint8Array(w * h);
  let near = own.slice();
  for (let pass = 0; pass < SEAM; pass++) {
    const next = near.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (!near[y * w + x] && ((x > 0 && near[y * w + x - 1]) || (x < w - 1 && near[y * w + x + 1]) || (y > 0 && near[(y - 1) * w + x]) || (y < h - 1 && near[(y + 1) * w + x])))
          next[y * w + x] = 1;
    near = next;
  }
  let todo = 0;
  for (let p = 0; p < w * h; p++) {
    if (own[p] || (near[p] && d[p * 4 + 3] >= 200)) {
      state[p] = 2;
      todo++;
    } else if (d[p * 4 + 3] >= 200) state[p] = 1;
  }

  // Grow known colors inward, one ring per pass, averaging the known 8-neighbors.
  while (todo > 0) {
    const fill: Array<[number, number, number, number]> = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (state[p] !== 2) continue;
        let n = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if ((dx || dy) && xx >= 0 && yy >= 0 && xx < w && yy < h && state[yy * w + xx] === 1) {
              const q = (yy * w + xx) * 4;
              n++;
              r += d[q];
              g += d[q + 1];
              b += d[q + 2];
            }
          }
        }
        if (n) fill.push([p, r / n, g / n, b / n]);
      }
    }
    if (!fill.length) break; // the rest can't be reached from known pixels
    for (const [p, r, g, b] of fill) {
      d[p * 4] = r;
      d[p * 4 + 1] = g;
      d[p * 4 + 2] = b;
      d[p * 4 + 3] = 255;
      state[p] = 1;
    }
    todo -= fill.length;
  }
  ctx.putImageData(img, x0, y0);
}
