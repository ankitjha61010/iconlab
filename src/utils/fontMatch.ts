import type { LayerSet } from './imageLayers';
import { TEXT_FONTS, loadTextFonts } from './textFonts';

/**
 * Guesses which of the offered fonts lettering in the image is closest to.
 *
 * Each letter shape is compared with every letter of every offered font
 * (drawn at the same size, both scaled to one height) by how much they
 * overlap; a font scores how well its best-fitting letters cover the text.
 * The best fit also works out which letter it is, so the text doesn't have to
 * be read. It picks the nearest look among TEXT_FONTS; it can't name a font
 * it doesn't have.
 */

export interface FontGuess {
  font: string;
  label: string;
  bold: boolean;
  italic: boolean;
}

interface Mask {
  w: number;
  h: number;
  on: Uint8Array;
}

/** The letters each font is compared with. */
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789&';
/** Letter shapes are compared at this height (px). */
const NORM = 32;
/** At most this many of the text's letters are compared (the tallest). */
const MAX_LETTERS = 24;
/** Lean beyond the font's own above which the text counts as italic. */
const ITALIC_LEAN = 0.12;

// ---------------------------------------------------------------------------
// Which pieces are the text
// ---------------------------------------------------------------------------

function meanColor(image: ImageData, set: LayerSet, i: number): [number, number, number] {
  const L = set.layers[i];
  const c = [0, 0, 0];
  let n = 0;
  for (let y = L.y; y < L.y + L.h; y++) {
    for (let x = L.x; x < L.x + L.w; x++) {
      const p = y * set.width + x;
      if (set.labels[p] !== i) continue;
      c[0] += image.data[p * 4];
      c[1] += image.data[p * 4 + 1];
      c[2] += image.data[p * 4 + 2];
      n++;
    }
  }
  return n ? [c[0] / n, c[1] / n, c[2] / n] : [0, 0, 0];
}

/**
 * Element `i` plus the letters beside it on the same line (similar color,
 * close together) — a split word is measured as a whole. Grows outward from
 * `i`, so even clicking a letter's serif or an i's dot finds the line.
 */
export function linePieces(image: ImageData, set: LayerSet, i: number): number[] {
  // A word has no pixels: start from its first letter.
  if (set.layers[i]?.word) {
    const first = set.layers.findIndex((L) => L.parent === i && !L.word);
    if (first < 0) return [];
    i = first;
  }
  const A = set.layers[i];
  if (!A) return [];
  const color = meanColor(image, set, i);
  // On a background, letters differ from it the same way (dark text on white: all darker, though thin
  // letters, being mostly anti-aliased edge, only a little). On transparency, compare the colors.
  const bg = A.parent !== null ? meanColor(image, set, A.parent) : null;
  const toward = bg && color.map((v, k) => v - bg[k]);
  const sameInk = (c: number[]) => {
    if (!toward || !bg) return Math.hypot(c[0] - color[0], c[1] - color[1], c[2] - color[2]) <= 110;
    const d = c.map((v, k) => v - bg[k]);
    const la = Math.hypot(...toward);
    const lb = Math.hypot(...d);
    if (la < 20 || lb < 20) return false;
    return (d[0] * toward[0] + d[1] * toward[1] + d[2] * toward[2]) / (la * lb) >= 0.85;
  };
  const colored = set.layers.flatMap((L, j) => (j === i || L.word || L.area < 4 || !sameInk(meanColor(image, set, j)) ? [] : [j]));
  const line = [i];
  const box = { x0: A.x, y0: A.y, x1: A.x + A.w, y1: A.y + A.h };
  let grew = true;
  while (grew) {
    grew = false;
    const hh = box.y1 - box.y0;
    for (let k = 0; k < colored.length; k++) {
      const j = colored[k];
      if (j < 0) continue;
      const L = set.layers[j];
      const cy = L.y + L.h / 2;
      // On this line: its middle within the line's band (or the line within it, for a tiny start), not too big, close by.
      const gap = Math.max(L.x - box.x1, box.x0 - (L.x + L.w));
      // A touching piece spanning the whole line so far is the letter the start belongs to.
      const holds = L.y <= box.y0 && L.y + L.h >= box.y1 && gap <= 1;
      const inBand = cy >= box.y0 && cy <= box.y1 && L.h <= Math.max(hh, 4) * 2.5;
      if (!(holds || inBand) || gap > Math.max(hh, L.h) * 1.2) continue;
      line.push(j);
      colored[k] = -1;
      box.x0 = Math.min(box.x0, L.x);
      box.y0 = Math.min(box.y0, L.y);
      box.x1 = Math.max(box.x1, L.x + L.w);
      box.y1 = Math.max(box.y1, L.y + L.h);
      grew = true;
    }
  }
  return line;
}

/** The image's longest line of lettering (for text added from scratch), or null. */
export function mainTextPieces(image: ImageData, set: LayerSet): number[] | null {
  const tall = set.height * 0.2;
  let best: number[] | null = null;
  const seen = new Set<number>();
  set.layers.forEach((L, i) => {
    if (seen.has(i) || L.word || !L.selectable || L.h < 6 || L.h > tall || L.w > L.h * 40) return;
    const line = linePieces(image, set, i);
    line.forEach((j) => seen.add(j));
    const letters = line.reduce((n, j) => n + set.layers[j].parts, 0);
    if (letters >= 3 && (!best || letters > best.reduce((n, j) => n + set.layers[j].parts, 0))) best = line;
  });
  return best;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * The lettering of `pieces` as a mask. Pieces of small text also hold the tiny
 * gaps inside and between letters, so a pixel counts only when its color is
 * nearer the text's color than the background's.
 */
function piecesMask(image: ImageData, set: LayerSet, pieces: number[]): Mask {
  return lettering(image, set, pieces).mask;
}

/** The color of the lettering in `pieces` (as hex), from the pixels most unlike the background around it. */
export function inkColor(image: ImageData, set: LayerSet, pieces: number[]): string {
  const [r, g, b] = lettering(image, set, pieces).ink;
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function lettering(image: ImageData, set: LayerSet, pieces: number[]): { mask: Mask; ink: number[] } {
  const ls = pieces.map((j) => set.layers[j]);
  const x0 = Math.min(...ls.map((L) => L.x));
  const y0 = Math.min(...ls.map((L) => L.y));
  const w = Math.max(...ls.map((L) => L.x + L.w)) - x0;
  const h = Math.max(...ls.map((L) => L.y + L.h)) - y0;
  const want = new Set(pieces);
  const px = image.data;
  const inLine: number[] = [];
  const around = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y0 + y) * set.width + x0 + x;
      if (want.has(set.labels[p])) inLine.push(p);
      else if (px[p * 4 + 3] >= 128) {
        around[0] += px[p * 4];
        around[1] += px[p * 4 + 1];
        around[2] += px[p * 4 + 2];
        around[3]++;
      }
    }
  }
  const on = new Uint8Array(w * h);
  const set1 = (p: number) => (on[(Math.floor(p / set.width) - y0) * w + (p % set.width) - x0] = 1);
  // No background inside the box (a cut-out word on transparency): the pieces are the letters.
  if (around[3] < 8) {
    const ink = [0, 0, 0];
    let n = 0;
    for (const p of inLine) {
      if (px[p * 4 + 3] < 128) continue;
      set1(p);
      for (let k = 0; k < 3; k++) ink[k] += px[p * 4 + k];
      n++;
    }
    return { mask: { w, h, on }, ink: ink.map((v) => v / Math.max(1, n)) };
  }
  const bg = [around[0] / around[3], around[1] / around[3], around[2] / around[3]];
  const far = (p: number) => Math.hypot(px[p * 4] - bg[0], px[p * 4 + 1] - bg[1], px[p * 4 + 2] - bg[2]);
  // The text color: the line's pixels most unlike the background.
  const byFar = inLine.filter((p) => px[p * 4 + 3] >= 128).sort((a, b) => far(b) - far(a));
  const core = byFar.slice(0, Math.max(1, Math.ceil(byFar.length * 0.3)));
  const ink = [0, 1, 2].map((k) => core.reduce((sum, p) => sum + px[p * 4 + k], 0) / core.length);
  for (const p of byFar) {
    const toInk = Math.hypot(px[p * 4] - ink[0], px[p * 4 + 1] - ink[1], px[p * 4 + 2] - ink[2]);
    if (toInk < far(p)) set1(p);
  }
  return { mask: { w, h, on }, ink };
}

/** A connected shape: its box within the mask and its own pixels. */
interface Shape {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
  pixels: number[];
}

function shapes(m: Mask): Shape[] {
  const { w, h, on } = m;
  const seen = new Uint8Array(w * h);
  const out: Shape[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!on[s] || seen[s]) continue;
    const pixels = [s];
    seen[s] = 1;
    let x0 = w;
    let x1 = -1;
    let y0 = h;
    let y1 = -1;
    for (let k = 0; k < pixels.length; k++) {
      const p = pixels[k];
      const x = p % w;
      const y = (p - x) / w;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx;
          if (on[q] && !seen[q]) {
            seen[q] = 1;
            pixels.push(q);
          }
        }
      }
    }
    out.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area: pixels.length, pixels });
  }
  return out;
}

/** Letters: shapes tall enough not to be dots, accents or punctuation. Letters touching each other (small text) are cut apart. */
function letters(m: Mask) {
  const all = shapes(m)
    .filter((c) => c.area >= 4)
    .flatMap((c) => splitTouching(m, c));
  const big = Math.max(0, ...all.map((c) => c.h));
  return all.filter((c) => c.h >= big * 0.45);
}

/**
 * Cuts a shape wider than one letter at its thinnest columns (where two
 * letters barely touch), keeping every part at least a quarter of its height wide.
 */
function splitTouching(m: Mask, c: Shape): Shape[] {
  if (c.w <= c.h * 1.05) return [c];
  const ink = new Int32Array(c.w);
  for (const p of c.pixels) ink[(p % m.w) - c.x]++;
  const thin = Math.max(1, Math.round(c.h * 0.12));
  const minPart = Math.max(2, Math.round(c.h * 0.25));
  const cuts: number[] = [];
  let from = 0;
  for (let x = minPart; x < c.w - minPart; x++) {
    if (ink[x] > thin || x - from < minPart) continue;
    // The thinnest column of this thin stretch.
    let at = x;
    while (x + 1 < c.w - minPart && ink[x + 1] <= thin) if (ink[++x] < ink[at]) at = x;
    cuts.push(at);
    from = at;
  }
  if (!cuts.length) return [c];
  const bounds = [0, ...cuts, c.w];
  const parts: Shape[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const pixels = c.pixels.filter((p) => {
      const x = (p % m.w) - c.x;
      return x >= bounds[k] && x < bounds[k + 1];
    });
    if (!pixels.length) continue;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of pixels) {
      const x = p % m.w;
      const y = (p - x) / m.w;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    parts.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area: pixels.length, pixels });
  }
  return parts;
}

const median = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Lean that makes vertical strokes most upright: the shear giving the sharpest column histogram. */
function findSlant(m: Mask) {
  const { w, h, on } = m;
  let best = 0;
  let bestScore = -1;
  for (let s = -0.1; s <= 0.45 + 1e-9; s += 0.025) {
    const cols = new Float64Array(w + h + 2);
    for (let y = 0; y < h; y++) {
      const shift = s * (y - h / 2);
      for (let x = 0; x < w; x++) if (on[y * w + x]) cols[Math.round(x + shift + h / 2)]++;
    }
    let score = 0;
    for (const c of cols) score += c * c;
    if (score > bestScore) [best, bestScore] = [s, score];
  }
  return best;
}

function unshear(m: Mask, slant: number): Mask {
  if (!slant) return m;
  const extra = Math.ceil(Math.abs(slant) * m.h);
  const w = m.w + extra;
  const on = new Uint8Array(w * m.h);
  for (let y = 0; y < m.h; y++) {
    const shift = Math.round(slant * (y - m.h / 2) + extra / 2);
    for (let x = 0; x < m.w; x++) if (m.on[y * m.w + x]) on[y * w + Math.max(0, Math.min(w - 1, x + shift))] = 1;
  }
  return { w, h: m.h, on };
}

/** A shape scaled to NORM px tall (keeping its proportions), as a bitmap plus its ink count. */
interface Norm {
  w: number;
  bits: Uint8Array;
  ink: number;
}

function normalize(m: Mask, c: Shape): Norm {
  const w = Math.max(1, Math.min(NORM * 3, Math.round((c.w * NORM) / c.h)));
  const own = new Uint8Array(c.w * c.h);
  for (const p of c.pixels) {
    const x = p % m.w;
    own[((p - x) / m.w - c.y) * c.w + (x - c.x)] = 1;
  }
  const bits = new Uint8Array(w * NORM);
  let ink = 0;
  for (let y = 0; y < NORM; y++) {
    const sy = Math.min(c.h - 1, Math.floor(((y + 0.5) * c.h) / NORM));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(c.w - 1, Math.floor(((x + 0.5) * c.w) / w));
      if (own[sy * c.w + sx]) {
        bits[y * w + x] = 1;
        ink++;
      }
    }
  }
  return { w, bits, ink };
}

/** Overlap (intersection over union) of two normalized shapes, centered on each other. */
function overlap(a: Norm, b: Norm) {
  // Very different proportions can't be the same letter.
  if (a.w > b.w * 1.6 + 2 || b.w > a.w * 1.6 + 2) return 0;
  const [wide, narrow] = a.w >= b.w ? [a, b] : [b, a];
  const off = Math.floor((wide.w - narrow.w) / 2);
  let both = 0;
  for (let y = 0; y < NORM; y++) for (let x = 0; x < narrow.w; x++) if (narrow.bits[y * narrow.w + x] && wide.bits[y * wide.w + x + off]) both++;
  return both / (a.ink + b.ink - both);
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

const glyphCache = new Map<string, Norm[]>();
let scratch: CanvasRenderingContext2D | null = null;

/** Draws one letter; returns its mask (with a margin) or null if nothing was drawn. */
function drawGlyph(ch: string, css: string, px: number): Mask | null {
  const size = Math.ceil(px * 2);
  const ctx = scratchSized(size, size);
  ctx.clearRect(0, 0, size, size);
  ctx.font = css;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.fillText(ch, px * 0.4, size / 2);
  const m = toMask(ctx.getImageData(0, 0, size, size).data, size, size);
  return m.on.some((v) => v) ? m : null;
}

function scratchSized(w: number, h: number) {
  if (!scratch) scratch = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const canvas = scratch.canvas;
  if (canvas.width < w || canvas.height < h) {
    canvas.width = Math.max(canvas.width, w);
    canvas.height = Math.max(canvas.height, h);
  }
  return scratch;
}

function toMask(data: Uint8ClampedArray, w: number, h: number): Mask {
  const on = new Uint8Array(w * h);
  for (let p = 0; p < on.length; p++) if (data[p * 4 + 3] >= 110) on[p] = 1;
  return { w, h, on };
}

/** Font px at which this font's capital letters are `capH` px tall. */
function sizeFor(css: (px: number) => string, capH: number) {
  const m = drawGlyph('H', css(100), 100);
  const hh = m ? Math.max(...letters(m).map((c) => c.h)) : 70;
  return Math.max(6, Math.round((100 * capH) / Math.max(1, hh)));
}

/** Letters are drawn at most this tall to be compared; they're scaled to NORM px anyway. */
const MAX_DRAW = 64;

/**
 * A font's letters drawn so capitals are `capH` px tall (small text: the same
 * pixel rounding as the image), normalized. All letters go on one canvas, read once.
 */
function glyphsOf(font: string, bold: boolean, capH: number): Norm[] {
  const drawH = Math.round(Math.min(capH, MAX_DRAW));
  const key = `${font}|${bold}|${drawH}`;
  const hit = glyphCache.get(key);
  if (hit) return hit;
  const css = (px: number) => `${bold ? 700 : 400} ${px}px ${font}`;
  const px = sizeFor(css, drawH);
  const cell = Math.ceil(px * 2);
  const cols = 8;
  const rows = Math.ceil(GLYPHS.length / cols);
  const ctx = scratchSized(cell * cols, cell * rows);
  ctx.clearRect(0, 0, cell * cols, cell * rows);
  ctx.font = css(px);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  [...GLYPHS].forEach((ch, k) => ctx.fillText(ch, (k % cols) * cell + px * 0.4, Math.floor(k / cols) * cell + cell / 2));
  const all = ctx.getImageData(0, 0, cell * cols, cell * rows).data;
  const out: Norm[] = [];
  const data = new Uint8ClampedArray(cell * cell * 4);
  for (let k = 0; k < GLYPHS.length; k++) {
    const x0 = (k % cols) * cell;
    const y0 = Math.floor(k / cols) * cell;
    for (let y = 0; y < cell; y++) data.set(all.subarray(((y0 + y) * cell * cols + x0) * 4, ((y0 + y) * cell * cols + x0 + cell) * 4), y * cell * 4);
    const m = toMask(data, cell, cell);
    // The letter's main shape (an i's stem, not its dot), as the image's letters are measured.
    const main = shapes(m).sort((a, b) => b.area - a.area)[0];
    if (main) out.push(normalize(m, main));
  }
  glyphCache.set(key, out);
  return out;
}

/** How well a font's letters cover the text's letters: mean best overlap. */
function fit(targets: Norm[], glyphs: Norm[]) {
  let sum = 0;
  for (const t of targets) {
    let best = 0;
    for (const g of glyphs) best = Math.max(best, overlap(t, g));
    sum += best;
  }
  return sum / targets.length;
}

/** The offered fonts ranked by how closely they fit the lettering in `pieces` (best first); empty if it doesn't look like text. */
export async function rankFonts(image: ImageData, set: LayerSet, pieces: number[]): Promise<Array<FontGuess & { score: number }>> {
  if (!pieces.length) return [];
  await loadTextFonts();
  const mask = piecesMask(image, set, pieces);
  const slant = findSlant(mask);
  // Compared both as drawn and straightened: a script font leans by itself, other text leans when italic.
  const versions = [
    { mask, italic: false },
    ...(slant > ITALIC_LEAN ? [{ mask: unshear(mask, slant), italic: true }] : []),
  ].map((v) => {
    const ls = letters(v.mask)
      .sort((a, b) => b.h - a.h)
      .slice(0, MAX_LETTERS);
    return { ...v, ls, targets: ls.map((c) => normalize(v.mask, c)) };
  });
  if (!versions[0].ls.length || Math.max(...versions[0].ls.map((c) => c.h)) < 6) return [];
  // Scale candidates so their capitals match the text's tallest letters (caps, digits, ascenders).
  const capH = median(versions[0].ls.slice(0, Math.max(1, Math.ceil(versions[0].ls.length / 3))).map((c) => c.h));
  const ranked: Array<FontGuess & { score: number }> = [];
  for (const f of TEXT_FONTS) {
    // Each font once, at its best weight and slant.
    let best: (FontGuess & { score: number }) | null = null;
    for (const weight of f.weights) {
      const glyphs = glyphsOf(f.value, weight === 700, capH);
      for (const v of versions) {
        const score = fit(v.targets, glyphs);
        if (!best || score > best.score) best = { font: f.value, label: f.label, bold: weight === 700, italic: v.italic, score };
      }
    }
    if (best) ranked.push(best);
  }
  return ranked.filter((g) => g.score >= 0.35).sort((a, b) => b.score - a.score);
}

/** The closest offered font for the lettering in `pieces`, or null if it doesn't look like text. */
export async function matchFont(image: ImageData, set: LayerSet, pieces: number[]): Promise<FontGuess | null> {
  const [best] = await rankFonts(image, set, pieces);
  if (!best) return null;
  const { score: _, ...guess } = best;
  return guess;
}
