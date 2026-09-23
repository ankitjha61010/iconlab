/**
 * Fills a spot with the background around it, as if what was there had never
 * been drawn. Used for deleted / moved elements and the heal brush.
 *
 * The pixels just around the spot decide how:
 *  - one color all round (a white card) → that color, exactly;
 *  - a smooth gradient (a header) → the gradient, continued across the spot;
 *  - several backgrounds (a stroke from a badge onto the card) → each part of
 *    the spot takes the background nearest to it.
 * Other artwork that touches the spot (a border, a shadow, a nearby label) is
 * outvoted, so it doesn't bleed in as streaks.
 */

/** Pixel states: 0 = leave, 1 = known color, 2 = to fill. */
export type HealState = Uint8Array;

/** The ring around the spot (px) its background is read from; past a drop shadow, but near. */
const SAMPLE_FROM = 3;
const BAND = 12;
/** Margin (px) callers should include around a spot so its surroundings can be sampled. */
export const HEAL_REACH = BAND;
/** Most a glow around the spot may differ from the background (RGB distance) to be cleaned up; darker shades of it always may. */
const SHADOW = 40;
/** Within RIM px of the spot, what's left of the element's own blended edge may differ up to this much. */
const RIM = 2;
const SEAM_RIM = 80;
/** Closer than this (RGB distance) to the background, a shadow has faded out. */
const FADED = 3;
/** RGB distance within which a sample agrees with the background model. */
const AGREE = 16;
/** RGB distance for "all one color" (a flat background, give or take compression noise). */
const EXACT = 6;
/** Share of samples that must agree for one solid color / gradient over the whole spot. */
const MAJORITY = 0.9;
/** Smallest share of the samples a background color needs to count (less is other artwork). */
const MINOR = 0.1;

/** Fills every state-2 pixel of `d` (RGBA, `w` × `h`) and makes it opaque. */
export function healPixels(d: Uint8ClampedArray, w: number, h: number, state: HealState) {
  const { samples, dist } = surroundings(w, h, state);
  // An exact plain color first, then a gradient, then a roughly plain color.
  const model = samples.length >= 8 ? (fitSolid(d, samples, EXACT) ?? fitGradient(d, w, samples) ?? fitSolid(d, samples, AGREE)) : null;
  if (model) {
    const spot = state.map((v) => (v === 2 ? 1 : 0));
    for (let p = 0; p < w * h; p++) {
      if (state[p] !== 2) continue;
      const x = p % w;
      const c = model((p - x) / w, x);
      d[p * 4] = c[0];
      d[p * 4 + 1] = c[1];
      d[p * 4 + 2] = c[2];
      d[p * 4 + 3] = 255;
      state[p] = 1;
    }
    cleanShadow(d, w, h, state, dist, spot, model);
    return;
  }
  blendLines(d, w, h, state, backgroundColors(d, samples, dist));
  growRings(d, w, h, state);
}

/**
 * The main background colors among the samples. Returns, per pixel of the
 * sampled band, the background color it shows (a shadow shows the color it
 * darkens), or null for pixels that are other artwork (small text, a border).
 */
function backgroundColors(d: Uint8ClampedArray, samples: number[], dist: Uint8Array) {
  const colorOf = new Map<number, readonly number[]>();
  let rest = samples;
  while (rest.length >= Math.max(8, samples.length * MINOR)) {
    const c = modeColor(d, rest);
    const left: number[] = [];
    let taken = 0;
    for (const q of rest) {
      if (off(d, q, c) <= AGREE * AGREE || shadeOf(d, q, c)) {
        colorOf.set(q, c);
        taken++;
      } else left.push(q);
    }
    // A color this rare is artwork on the background, not a background: drop what it took.
    if (taken < samples.length * MINOR) {
      for (const q of rest) if (colorOf.get(q) === c) colorOf.delete(q);
      break;
    }
    rest = left;
  }
  return (p: number): readonly number[] | null | undefined => (dist[p] ? (colorOf.get(p) ?? null) : undefined);
}

/** Known pixels SAMPLE_FROM–BAND px (4-connected steps) from the spot, and each pixel's step distance. */
function surroundings(w: number, h: number, state: HealState) {
  const dist = new Uint8Array(w * h);
  let ring: number[] = [];
  for (let p = 0; p < w * h; p++) if (state[p] === 2) ring.push(p);
  const out: number[] = [];
  for (let step = 1; step <= BAND && ring.length; step++) {
    const next: number[] = [];
    for (const p of ring) {
      const x = p % w;
      const visit = (q: number) => {
        if (state[q] === 2 || dist[q]) return;
        dist[q] = step;
        next.push(q);
        if (state[q] === 1 && step >= SAMPLE_FROM) out.push(q);
      };
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (p >= w) visit(p - w);
      if (p < w * h - w) visit(p + w);
    }
    ring = next;
  }
  // Too thin a surrounding band (a spot at the edge of the box): use every known pixel near it.
  if (out.length < 8) for (let q = 0; q < w * h; q++) if (state[q] === 1 && dist[q]) out.push(q);
  return { samples: out, dist };
}

/**
 * Repaints the drop shadow or glow the element cast around it: darker shades
 * of the background joined to the spot, and other pixels just outside it that
 * differ from the background less and less going outward. It stops at the
 * background itself, so a border or label past a gap is left alone.
 */
function cleanShadow(d: Uint8ClampedArray, w: number, h: number, state: HealState, dist: Uint8Array, spot: Uint8Array, model: Model) {
  const dev = new Float32Array(w * h).fill(-1);
  const paint: number[] = [];
  for (let step = 1; step <= BAND; step++) {
    let any = false;
    for (let q = 0; q < w * h; q++) {
      if (dist[q] !== step || state[q] !== 1 || d[q * 4 + 3] < 200) continue;
      const x = q % w;
      // The strongest inner neighbor that is part of the shadow; the spot itself allows anything up to SHADOW.
      let limit = -1;
      const look = (p: number) => {
        if (step === 1 ? spot[p] : dist[p] === step - 1 && dev[p] >= 0) limit = Math.max(limit, step === 1 ? Infinity : dev[p]);
      };
      if (x > 0) look(q - 1);
      if (x < w - 1) look(q + 1);
      if (q >= w) look(q - w);
      if (q < w * h - w) look(q + w);
      if (limit < 0) continue;
      const c = model((q - x) / w, x);
      const v = Math.sqrt(off(d, q, c));
      // Background already, or getting stronger outward (not a fading shadow): stop here.
      // Right at the spot's edge, its own blended rim may be stronger (a mix of it and the background).
      const cap = step <= RIM ? SEAM_RIM : SHADOW;
      // A shade of the background joined to the spot is its shadow even where it deepens (an offset shadow's corner).
      const shade = shadeOf(d, q, c);
      if (v <= FADED || (!shade && (v > cap || v > limit + 4))) continue;
      dev[q] = v;
      paint.push(q);
      any = true;
    }
    if (!any) break;
  }
  for (const q of paint) {
    const x = q % w;
    const c = model((q - x) / w, x);
    d[q * 4] = c[0];
    d[q * 4 + 1] = c[1];
    d[q * 4 + 2] = c[2];
  }
}

type Model = (y: number, x: number) => [number, number, number];

/** The most common color around, if most of the surroundings are that color. */
function fitSolid(d: Uint8ClampedArray, samples: number[], tolerance: number): Model | null {
  const color = modeColor(d, samples);
  let agree = 0;
  // A drop shadow on the background counts for it: it's the same color, just darker.
  for (const q of samples) if (off(d, q, color) <= tolerance * tolerance || shadeOf(d, q, color)) agree++;
  return agree >= samples.length * MAJORITY ? () => color : null;
}

/** The average of the most common (quantized) color among `samples`. */
function modeColor(d: Uint8ClampedArray, samples: number[]): [number, number, number] {
  const buckets = new Map<number, number[]>();
  for (const q of samples) {
    const key = ((d[q * 4] >> 3) << 10) | ((d[q * 4 + 1] >> 3) << 5) | (d[q * 4 + 2] >> 3);
    const b = buckets.get(key);
    if (b) b.push(q);
    else buckets.set(key, [q]);
  }
  let top: number[] = [];
  for (const b of buckets.values()) if (b.length > top.length) top = b;
  const c = [0, 0, 0];
  for (const q of top) for (let k = 0; k < 3; k++) c[k] += d[q * 4 + k];
  return [c[0] / top.length, c[1] / top.length, c[2] / top.length];
}

/** A straight gradient (per channel a + b·x + c·y) that most of the surroundings fit. */
function fitGradient(d: Uint8ClampedArray, w: number, samples: number[]): Model | null {
  let use = samples;
  let model: Model | null = null;
  // Fit, drop the samples that don't fit (other artwork), fit again.
  for (let pass = 0; pass < 2; pass++) {
    model = planeFit(d, w, use);
    if (!model) return null;
    const m = model;
    const agree = samples.filter((q) => {
      const x = q % w;
      return off(d, q, m((q - x) / w, x)) <= AGREE * AGREE;
    });
    if (pass === 1) return agree.length >= samples.length * MAJORITY ? model : null;
    if (agree.length < 8) return null;
    use = agree;
  }
  return model;
}

function planeFit(d: Uint8ClampedArray, w: number, samples: number[]): Model | null {
  // Normal equations for [1, x, y], coordinates centered for stability.
  let mx = 0;
  let my = 0;
  for (const q of samples) {
    mx += q % w;
    my += Math.floor(q / w);
  }
  mx /= samples.length;
  my /= samples.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  const sv = [0, 0, 0];
  const sxv = [0, 0, 0];
  const syv = [0, 0, 0];
  for (const q of samples) {
    const x = (q % w) - mx;
    const y = Math.floor(q / w) - my;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    for (let k = 0; k < 3; k++) {
      const v = d[q * 4 + k];
      sv[k] += v;
      sxv[k] += x * v;
      syv[k] += y * v;
    }
  }
  const det = sxx * syy - sxy * sxy;
  const n = samples.length;
  const coef = [0, 1, 2].map((k) => {
    const a = sv[k] / n;
    // A spot sampled along a single line has no slope across it: keep that direction flat.
    if (Math.abs(det) < 1e-6) return [a, sxx ? sxv[k] / sxx : 0, syy ? syv[k] / syy : 0];
    return [a, (sxv[k] * syy - syv[k] * sxy) / det, (syv[k] * sxx - sxv[k] * sxy) / det];
  });
  return (y, x) => {
    const dx = x - mx;
    const dy = y - my;
    return [0, 1, 2].map((k) => Math.max(0, Math.min(255, coef[k][0] + coef[k][1] * dx + coef[k][2] * dy))) as [number, number, number];
  };
}

/** Whether pixel `q` looks like background color `c` in shadow: darker, by about the same share in each channel. */
function shadeOf(d: Uint8ClampedArray, q: number, c: readonly number[]) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < 3; k++) {
    const v = d[q * 4 + k];
    if (v > c[k] + 3) return false;
    if (c[k] < 24) continue;
    const r = v / c[k];
    lo = Math.min(lo, r);
    hi = Math.max(hi, r);
  }
  return lo !== Infinity && lo >= 0.45 && lo < 0.985 && hi - lo <= 0.12;
}

function off(d: Uint8ClampedArray, q: number, c: readonly number[]) {
  const dr = d[q * 4] - c[0];
  const dg = d[q * 4 + 1] - c[1];
  const db = d[q * 4 + 2] - c[2];
  return dr * dr + dg * dg + db * db;
}

/**
 * Blends the nearest known pixels left, right, above and below, the nearest
 * counting by far the most. Around the spot, `background` gives the background color a pixel
 * shows (used instead of its own), or null to look past it (other artwork).
 */
function blendLines(d: Uint8ClampedArray, w: number, h: number, state: HealState, background: (p: number) => readonly number[] | null | undefined) {
  const acc = new Float32Array(w * h * 4);
  const sweep = (start: number, step: number, len: number) => {
    for (let dir = 0; dir < 2; dir++) {
      let last = -1;
      for (let k = 0; k < len; k++) {
        const j = dir ? len - 1 - k : k;
        const p = start + j * step;
        if (state[p] === 1) {
          if (background(p) !== null) last = j;
        } else if (state[p] === 2 && last >= 0) {
          const q = start + last * step;
          const c = background(q);
          // Steep falloff: the nearest background owns the pixel, blending only where two are about as near.
          const gap = Math.abs(j - last);
          const wt = 1 / (gap * gap * gap * gap);
          acc[p * 4] += (c ? c[0] : d[q * 4]) * wt;
          acc[p * 4 + 1] += (c ? c[1] : d[q * 4 + 1]) * wt;
          acc[p * 4 + 2] += (c ? c[2] : d[q * 4 + 2]) * wt;
          acc[p * 4 + 3] += wt;
        }
      }
    }
  };
  for (let y = 0; y < h; y++) sweep(y * w, 1, w);
  for (let x = 0; x < w; x++) sweep(x, w, h);
  for (let p = 0; p < w * h; p++) {
    const wt = acc[p * 4 + 3];
    if (state[p] !== 2 || !wt) continue;
    d[p * 4] = acc[p * 4] / wt;
    d[p * 4 + 1] = acc[p * 4 + 1] / wt;
    d[p * 4 + 2] = acc[p * 4 + 2] / wt;
    d[p * 4 + 3] = 255;
    state[p] = 1;
  }
}

/** Anything still unfilled: grow known colors inward ring by ring, averaging the known 8-neighbors. */
function growRings(d: Uint8ClampedArray, w: number, h: number, state: HealState) {
  const queued = new Uint8Array(w * h);
  const around = (p: number, visit: (q: number) => void) => {
    const x = p % w;
    const y = (p - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if ((dx || dy) && xx >= 0 && xx < w) visit(yy * w + xx);
      }
    }
  };
  let ring: number[] = [];
  for (let p = 0; p < w * h; p++) {
    if (state[p] !== 2) continue;
    let known = false;
    around(p, (q) => (known ||= state[q] === 1));
    if (known) {
      queued[p] = 1;
      ring.push(p);
    }
  }
  const colors: number[] = [];
  while (ring.length) {
    colors.length = 0;
    for (const p of ring) {
      let n = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      around(p, (q) => {
        if (state[q] !== 1) return;
        n++;
        r += d[q * 4];
        g += d[q * 4 + 1];
        b += d[q * 4 + 2];
      });
      colors.push(r / n, g / n, b / n);
    }
    // Paint the whole ring at once, so every pixel of it averages the previous ring only.
    ring.forEach((p, k) => {
      d[p * 4] = colors[k * 3];
      d[p * 4 + 1] = colors[k * 3 + 1];
      d[p * 4 + 2] = colors[k * 3 + 2];
      d[p * 4 + 3] = 255;
      state[p] = 1;
    });
    const next: number[] = [];
    for (const p of ring) {
      around(p, (q) => {
        if (state[q] === 2 && !queued[q]) {
          queued[q] = 1;
          next.push(q);
        }
      });
    }
    ring = next;
  }
}
