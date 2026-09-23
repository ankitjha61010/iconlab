import { HEAL_REACH, healPixels } from './heal';
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
  /** Big enough to be clicked and edited. */
  selectable: boolean;
  /** Among the largest elements, which show a dashed outline while editing. */
  outlined: boolean;
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
  /** A word of a split element: it has no pixels of its own; its letters follow it. */
  word?: boolean;
}

export interface LayerSet {
  width: number;
  height: number;
  /** Element index per pixel, −1 for (nearly) transparent pixels. */
  labels: Int32Array;
  layers: ImageLayer[];
  /** Word elements by their (negative) anchor. */
  words: Map<number, number>;
}

const VISIBLE = 8;
/** Only the largest elements show outlines, so busy images stay readable. */
const MAX_OUTLINED = 60;
/** Upper bound on clickable elements, so noisy images stay usable. */
const MAX_SELECTABLE = 600;

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
export function segmentLayers(image: ImageData, gap: number, splitAnchors: readonly number[] | 'all' = []): LayerSet {
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
  if (splitAnchors === 'all') for (const sh of shapes) splitRoot.set(rootOf[shapeOf[sh.anchor]], sh.anchor);
  else for (const a of splitAnchors) if (a >= 0 && a < n && shapeOf[a] >= 0) splitRoot.set(rootOf[shapeOf[a]], a);
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
      layers.push({ x, y, w: 1, h: 1, area: 0, anchor: p, selectable: false, outlined: false, parts: 1, splitAnchor: splitRoot.get(root) ?? null, parent: null });
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

  // Pieces of a split element may be small (a digit, a short label), so they get a lower bar.
  const minArea = (L: ImageLayer) => Math.max(12, n * (L.splitAnchor === null ? 0.0002 : 0.00005));
  layers
    .map((L, i) => [L.area, i] as const)
    .filter(([area, i]) => area >= minArea(layers[i]))
    .sort((a, b) => b[0] - a[0])
    .slice(0, MAX_SELECTABLE)
    .forEach(([, i], rank) => {
      layers[i].selectable = true;
      layers[i].outlined = rank < MAX_OUTLINED;
    });

  const words = new Map<number, number>();
  if (splitRoot.size) groupWords(image, labels, layers, words);
  return { width, height, labels, layers, words };
}

/**
 * Words of a split element: letters side by side on one line, on the same
 * background, in about the same color, with letter-sized gaps. Each word gets
 * an element of its own with no pixels, which its letters follow (as their
 * parent), so a word is picked and moved as one; its letters can still be
 * picked one by one. An i's dot or an accent joins the word it sits over.
 */
function groupWords(image: ImageData, labels: Int32Array, layers: ImageLayer[], words: Map<number, number>) {
  const { data, width } = image;
  const tall = image.height * 0.25;
  const cand = layers.flatMap((L, i) => (L.splitAnchor !== null && L.selectable && L.h <= tall && L.area >= 4 ? [i] : []));
  if (cand.length < 2) return;
  const color = new Map<number, number[]>();
  const colorOf = (i: number) => {
    const L = layers[i];
    const c = [0, 0, 0];
    let n = 0;
    for (let y = L.y; y < L.y + L.h; y++) {
      for (let x = L.x; x < L.x + L.w; x++) {
        const q = y * width + x;
        const p = q * 4;
        if (labels[q] !== i || data[p + 3] < 128) continue;
        c[0] += data[p];
        c[1] += data[p + 1];
        c[2] += data[p + 2];
        n++;
      }
    }
    return n ? c.map((v) => v / n) : c;
  };
  for (const i of cand) color.set(i, colorOf(i));

  const root = new Map(cand.map((i) => [i, i]));
  const find = (i: number): number => {
    let r = i;
    while (root.get(r) !== r) r = root.get(r)!;
    root.set(i, r);
    return r;
  };
  const byX = [...cand].sort((a, b) => layers[a].x - layers[b].x);
  for (let a = 0; a < byX.length; a++) {
    const A = layers[byX[a]];
    for (let b = a + 1; b < byX.length; b++) {
      const B = layers[byX[b]];
      const hh = Math.max(A.h, B.h);
      const gap = B.x - (A.x + A.w);
      if (gap > hh * WORD_GAP) {
        // Sorted by left edge: later ones only start further right, unless this one is much taller.
        if (B.x - (A.x + A.w) > tall) break;
        continue;
      }
      if (A.parent !== B.parent) continue;
      const overlap = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
      if (overlap < Math.min(A.h, B.h) * 0.5 || hh > Math.min(A.h, B.h) * 3) continue;
      const ca = color.get(byX[a])!;
      const cb = color.get(byX[b])!;
      if (Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]) > 80) continue;
      root.set(find(byX[b]), find(byX[a]));
    }
  }
  const groups = new Map<number, number[]>();
  for (const i of cand) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }
  const box = (g: number[]) => {
    const x0 = Math.min(...g.map((i) => layers[i].x));
    const y0 = Math.min(...g.map((i) => layers[i].y));
    return { x0, y0, x1: Math.max(...g.map((i) => layers[i].x + layers[i].w)), y1: Math.max(...g.map((i) => layers[i].y + layers[i].h)) };
  };
  // Dots and accents: a small loose piece just above or below a word, within its width.
  const multi = [...groups.values()].filter((g) => g.length >= 2);
  for (const [r, g] of groups) {
    if (g.length !== 1) continue;
    const L = layers[g[0]];
    const cx = L.x + L.w / 2;
    const home = multi.find((w) => {
      const b = box(w);
      const hh = b.y1 - b.y0;
      const near = L.y + L.h >= b.y0 - hh * 0.6 && L.y <= b.y1 + hh * 0.6;
      return layers[w[0]].parent === L.parent && cx >= b.x0 && cx <= b.x1 && near && L.h < hh * 0.6;
    });
    if (home) {
      home.push(g[0]);
      groups.delete(r);
    }
  }
  for (const g of multi) {
    const b = box(g);
    const first = g.reduce((a, i) => (layers[i].x < layers[a].x ? i : a), g[0]);
    const index = layers.length;
    const anchor = -1 - layers[first].anchor;
    layers.push({
      x: b.x0,
      y: b.y0,
      w: b.x1 - b.x0,
      h: b.y1 - b.y0,
      area: g.reduce((sum, i) => sum + layers[i].area, 0),
      anchor,
      selectable: true,
      outlined: g.some((i) => layers[i].outlined),
      parts: g.length,
      splitAnchor: layers[first].splitAnchor,
      parent: layers[first].parent,
      word: true,
    });
    words.set(anchor, index);
    for (const i of g) {
      layers[i].parent = index;
      layers[i].outlined = false;
    }
  }
}

/** The element an anchor stands for now: a pixel's element, or (negative anchors) a word. −1 if gone. */
export function anchorIndex(set: LayerSet, anchor: number) {
  return anchor >= 0 ? (set.labels[anchor] ?? -1) : (set.words.get(anchor) ?? -1);
}

/** Letters further apart than this share of their height are separate words. */
const WORD_GAP = 0.3;

/** Share of an element's surroundings that must belong to one bigger element for it to count as sitting inside it. */
const ENCLOSED = 0.6;
/** The same, for a bigger element whose box also holds it. */
const NESTED = 0.25;

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
  const contains = (P: ImageLayer, L: ImageLayer) => P.x <= L.x && P.y <= L.y && P.x + P.w >= L.x + L.w && P.y + P.h >= L.y + L.h;
  // Smaller elements inside its box (its own text, a letter's counter) aren't what it sits on.
  layers.forEach((L, i) => {
    for (const [j, c] of around[i]) {
      if (layers[j].area < L.area && contains(L, layers[j])) {
        total[i] -= c;
        around[i].delete(j);
      }
    }
  });
  layers.forEach((L, i) => {
    if (total[i] <= 0) return;
    let best = -1;
    let count = 0;
    for (const [j, c] of around[i]) if (c > count) [best, count] = [j, c];
    // A parent is always bigger, so parent chains can't loop.
    if (best >= 0 && count / total[i] >= ENCLOSED && layers[best].area > L.area) {
      L.parent = best;
      return;
    }
    // Partly wrapped in something else (a badge in its own drop shadow): the bigger
    // element it touches most whose box holds it, e.g. the card under both.
    best = -1;
    count = 0;
    for (const [j, c] of around[i]) if (c > count && layers[j].area > L.area && contains(layers[j], L)) [best, count] = [j, c];
    if (best >= 0 && count / total[i] >= NESTED) L.parent = best;
  });
  // Still loose: vote through neighbors (its shadow belongs to the card, so it does too).
  layers.forEach((L, i) => {
    if (L.parent !== null || total[i] <= 0) return;
    const votes = new Map<number, number>();
    for (const [j, c] of around[i]) {
      const via = layers[j].area > L.area ? j : layers[j].parent;
      if (via !== null && via !== i && layers[via].area > L.area && contains(layers[via], L)) votes.set(via, (votes.get(via) ?? 0) + c);
    }
    let best = -1;
    let count = 0;
    for (const [j, c] of votes) if (c > count) [best, count] = [j, c];
    if (best >= 0 && count / total[i] >= ENCLOSED) L.parent = best;
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

/** Color step to a neighbor (RGB distance) that counts as an edge between two parts. */
const EDGE = 6;
/** The same over 2 px, for soft edges; a smooth gradient changes far less than this in 2 px. */
const SOFT_EDGE = 9;
/** How close an edge pixel must be to a flat part's color to be its blended rim. */
const RIM = 56;
/** Edge pixels touching only one part must be this close to it to count as its rim; the rest are strokes (faint icons). */
const LONE_RIM = 22;
/** How far from a blended mix of two parts' colors (RGB distance) an edge pixel may be. */
const BLEND = 40;
/** How many px into an edge the rim reaches. */
const RIM_DEPTH = 3;

/**
 * Parts inside split groups. Flat areas bounded by a visible edge (a card, a
 * badge, a letter's fill) each become a part, so shapes sitting on a similar
 * color still come apart when a border or step separates them; smooth
 * gradients stay whole. Edge pixels close in color to a part they touch are its
 * blended rim; the rest (thin strokes such as small text, too thin to hold a
 * flat area) form parts of their own. Tiny fragments are handed to the part
 * they touch, so every visible pixel ends up in one.
 */
function colorRegions(image: ImageData, shapeOf: Int32Array, rootOf: Int32Array, splitRoot: Map<number, number>) {
  const { width, data } = image;
  const n = data.length / 4;
  const of = new Int32Array(n).fill(-1);
  const inSplit = (p: number) => shapeOf[p] >= 0 && splitRoot.has(rootOf[shapeOf[p]]);
  const sameGroup = (p: number, q: number) => shapeOf[q] >= 0 && rootOf[shapeOf[q]] === rootOf[shapeOf[p]];
  const dist2 = (p: number, q: number) => {
    const i = p * 4;
    const j = q * 4;
    const dr = data[i] - data[j];
    const dg = data[i + 1] - data[j + 1];
    const db = data[i + 2] - data[j + 2];
    return dr * dr + dg * dg + db * db;
  };
  const solid = (p: number) => data[p * 4 + 3] >= 128 && inSplit(p);
  const neighbors = (p: number, visit: (q: number) => void) => {
    const x = p % width;
    if (x > 0) visit(p - 1);
    if (x < width - 1) visit(p + 1);
    if (p >= width) visit(p - width);
    if (p < n - width) visit(p + width);
  };

  // 1. Flat pixels: no sharp color step to any solid neighbor of the same group.
  const flat = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (!solid(p)) continue;
    let steep = false;
    neighbors(p, (q) => {
      if (!steep && sameGroup(p, q) && data[q * 4 + 3] >= 128 && dist2(p, q) > EDGE * EDGE) steep = true;
    });
    // A soft edge (blurred or scaled up) spreads its step over a few px, each too small to count:
    // look 2 px out too, but only across such a ramp (a sharp edge further on is its own pixels' business).
    if (!steep) {
      const x = p % width;
      for (const step of [x > 1 ? -1 : 0, x < width - 2 ? 1 : 0, -width, width]) {
        const q1 = p + step;
        const q2 = p + 2 * step;
        if (!step || q2 < 0 || q2 >= n || !sameGroup(p, q2) || !sameGroup(p, q1) || data[q2 * 4 + 3] < 128) continue;
        if (dist2(p, q2) > SOFT_EDGE * SOFT_EDGE && dist2(q1, q2) <= EDGE * EDGE) {
          steep = true;
          break;
        }
      }
    }
    flat[p] = steep ? 0 : 1;
  }

  const stack = new Int32Array(n);
  const members: number[] = [];
  const minFragment = Math.max(24, n * 0.00005);
  const sums: number[][] = [];
  let count = 0;
  /** Fills a connected area from `start` with a new id; tiny ones are dissolved (−2). */
  const flood = (start: number, joins: (p: number, q: number) => boolean, min: number, eight: boolean) => {
    const id = count++;
    members.length = 0;
    let top = 0;
    of[start] = id;
    stack[top++] = start;
    while (top > 0) {
      const p = stack[--top];
      members.push(p);
      const push = (q: number) => {
        if (of[q] === -1 && sameGroup(p, q) && joins(p, q)) {
          of[q] = id;
          stack[top++] = q;
        }
      };
      neighbors(p, push);
      if (eight) {
        const x = p % width;
        if (p >= width && x > 0) push(p - width - 1);
        if (p >= width && x < width - 1) push(p - width + 1);
        if (p < n - width && x > 0) push(p + width - 1);
        if (p < n - width && x < width - 1) push(p + width + 1);
      }
    }
    const s = [0, 0, 0];
    for (const p of members) {
      s[0] += data[p * 4];
      s[1] += data[p * 4 + 1];
      s[2] += data[p * 4 + 2];
    }
    sums[id] = s.map((v) => v / members.length);
    if (members.length < min) for (const p of members) of[p] = -2;
  };

  // 2. Flat areas: connected flat pixels (smooth gradients chain along).
  for (let p = 0; p < n; p++) if (of[p] === -1 && flat[p]) flood(p, (_, q) => flat[q] === 1, minFragment, false);

  // 3. Edge pixels next to flat parts are their blended rims when they're close to a touching part's
  //    local color, or a mix of the two parts they sit between (a letter's anti-aliased edge).
  //    Each edge pixel learns the nearest pixel of up to two different parts within RIM_DEPTH px.
  const partA = new Int32Array(n).fill(-1);
  const partB = new Int32Array(n).fill(-1);
  const srcA = new Int32Array(n);
  const srcB = new Int32Array(n);
  let frontier: number[] = [];
  for (let p = 0; p < n; p++) {
    if (of[p] < 0) continue;
    partA[p] = of[p];
    srcA[p] = p;
    frontier.push(p);
  }
  const learn = (q: number, part: number, src: number) => {
    if (partA[q] === part || partB[q] === part) return false;
    if (partA[q] < 0) [partA[q], srcA[q]] = [part, src];
    else if (partB[q] < 0) [partB[q], srcB[q]] = [part, src];
    else return false;
    return true;
  };
  const rimPixels: number[] = [];
  for (let depth = 0; depth < RIM_DEPTH && frontier.length; depth++) {
    const next: number[] = [];
    for (const p of frontier) {
      neighbors(p, (q) => {
        if (of[q] !== -1 || !solid(q) || !sameGroup(p, q)) return;
        const fresh = partA[q] < 0;
        let changed = learn(q, partA[p], srcA[p]);
        if (partB[p] >= 0) changed = learn(q, partB[p], srcB[p]) || changed;
        if (fresh) rimPixels.push(q);
        if (changed) next.push(q);
      });
    }
    frontier = next;
  }
  const rimOf = (q: number) => {
    const dA = dist2(q, srcA[q]);
    // Next to one part only, it's a thin line or icon drawn on it unless it's barely different (noise).
    if (partB[q] < 0) return dA <= LONE_RIM * LONE_RIM ? partA[q] : -1;
    const dB = dist2(q, srcB[q]);
    const nearest = dA <= dB ? partA[q] : partB[q];
    if (Math.min(dA, dB) <= RIM * RIM) return nearest;
    // Distance from the color line between the two parts' colors.
    const i = q * 4;
    const a = srcA[q] * 4;
    const b = srcB[q] * 4;
    const ab = [data[b] - data[a], data[b + 1] - data[a + 1], data[b + 2] - data[a + 2]];
    const aq = [data[i] - data[a], data[i + 1] - data[a + 1], data[i + 2] - data[a + 2]];
    const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1;
    const t = Math.max(0, Math.min(1, (aq[0] * ab[0] + aq[1] * ab[1] + aq[2] * ab[2]) / len2));
    const off = [aq[0] - t * ab[0], aq[1] - t * ab[1], aq[2] - t * ab[2]];
    return off[0] * off[0] + off[1] * off[1] + off[2] * off[2] <= BLEND * BLEND ? nearest : -1;
  };
  // Decide all rims first, so one choice doesn't change what the next pixel sees.
  const rims = rimPixels.map(rimOf);
  rimPixels.forEach((q, k) => (of[q] = rims[k]));

  // 4. What's left are strokes too thin for a flat area (small text, lines): parts of their own.
  const minStroke = Math.max(6, minFragment / 4);
  for (let p = 0; p < n; p++) if (of[p] === -1 && solid(p)) flood(p, (_, q) => of[q] === -1 && solid(q), minStroke, true);

  // 5. Grow the parts into dissolved fragments and faint pixels of the same group.
  frontier = [];
  for (let p = 0; p < n; p++) if (of[p] >= 0) frontier.push(p);
  while (frontier.length) {
    const next: number[] = [];
    for (const p of frontier) {
      neighbors(p, (q) => {
        if (of[q] < 0 && sameGroup(p, q)) {
          of[q] = of[p];
          next.push(q);
        }
      });
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
  if (heal) {
    // Outside in: a card is filled before the text on it, which is then filled from the card. Biggest
    // first mostly does that; an element wrapped only in others still waiting (a field inside its own
    // border) waits for them and is tried again.
    // Words have no pixels of their own; their letters are removed and filled.
    const spots = removed.filter((i) => !set.layers[i].word);
    const pending = new Set(spots);
    let todo = spots;
    while (todo.length) {
      const waiting = todo.filter((i) => {
        pending.delete(i);
        if (inpaint(ctx, set, i, pending)) return false;
        pending.add(i);
        return true;
      });
      if (waiting.length === todo.length) break; // nothing around them will ever be filled
      todo = waiting;
    }
  }
  restCache.set(source, { set, key, canvas });
  return canvas;
}

/** How far past an element's edge its blended seam is repainted too. */
const SEAM = 2;

/**
 * Fills the spot element `i` left behind — if it sat on top of other artwork —
 * with the background around it (see `healPixels`). Its blended edge is
 * repainted too, so no ghost outline stays. Spots mostly surrounded by
 * transparency are left empty. `pending` elements (removed too but not filled
 * yet, like the text on a card that moves with it) don't count as surroundings.
 */
/** Returns false (nothing done) when everything around the spot is still `pending`. */
function inpaint(ctx: CanvasRenderingContext2D, set: LayerSet, i: number, pending: ReadonlySet<number>): boolean {
  const L = set.layers[i];
  // Room for the enclosure probe and for sampling the background around the spot.
  const pad = SEAM + HEAL_REACH + 1;
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
        const x3 = x + dx * 3;
        const y3 = y + dy * 3;
        const inside = x3 >= 0 && y3 >= 0 && x3 < w && y3 < h;
        if (inside) {
          const at = set.labels[(y0 + y3) * set.width + x0 + x3];
          if (at === i || (at >= 0 && pending.has(at))) continue;
        }
        edge++;
        if (inside && d[(y3 * w + x3) * 4 + 3] >= 200) solid++;
      }
    }
  }
  if (!edge) return false;
  if (solid / edge < ENCLOSED) return true;

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
  for (let p = 0; p < w * h; p++) {
    if (own[p] || (near[p] && d[p * 4 + 3] >= 200)) {
      state[p] = 2;
    } else if (d[p * 4 + 3] >= 200) state[p] = 1;
  }

  healPixels(d, w, h, state);
  ctx.putImageData(img, x0, y0);
  return true;
}
