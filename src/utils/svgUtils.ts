import type { IconCustomization, IconData } from '../types/icon';

/**
 * Safe SVG transformation helpers.
 *
 * Rules:
 * - Monochrome Iconify icons paint with `currentColor`; only that keyword is
 *   replaced when recoloring.
 * - Hard-coded colors (multicolor icons) are left untouched unless the user
 *   explicitly remaps one specific color, and then only exact matches of that
 *   color inside paint attributes/styles are rewritten.
 * - The original body markup is kept as-is and wrapped in a transform group.
 */

const PAINT_ATTRS = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'color'];
const ATTR_PATTERN = new RegExp(`(\\s(?:${PAINT_ATTRS.join('|')})\\s*=\\s*)(["'])([^"']*)\\2`, 'gi');
const STYLE_PATTERN = new RegExp(`((?:^|[;{\\s"'])(?:${PAINT_ATTRS.join('|')})\\s*:\\s*)([^;"'}]+)`, 'gi');
const IGNORED_VALUES = new Set(['none', 'transparent', 'currentcolor', 'inherit', 'initial', 'unset', '']);

export type ColorMode = 'mono' | 'mixed' | 'multi';

export interface ColorAnalysis {
  /** mono: only currentColor · mixed: currentColor + fixed colors · multi: fixed colors only */
  mode: ColorMode;
  usesCurrentColor: boolean;
  /** Distinct hard-coded colors in document order, normalized. */
  colors: string[];
  hasGradient: boolean;
}

/** Lower-cases colors and expands #abc → #aabbcc so equal colors compare equal. */
export function normalizeColor(value: string): string {
  const v = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return v;
}

function isPaintColor(value: string): boolean {
  const v = value.trim().toLowerCase();
  return !IGNORED_VALUES.has(v) && !v.startsWith('url(') && !v.startsWith('var(');
}

export function analyzeColors(body: string): ColorAnalysis {
  const colors: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    if (!isPaintColor(raw)) return;
    const c = normalizeColor(raw);
    if (!seen.has(c)) {
      seen.add(c);
      colors.push(c);
    }
  };
  for (const m of body.matchAll(ATTR_PATTERN)) add(m[3]);
  for (const m of body.matchAll(/style\s*=\s*(["'])([^"']*)\1/gi)) {
    for (const s of m[2].matchAll(STYLE_PATTERN)) add(s[2]);
  }
  const usesCurrentColor = /currentColor/i.test(body);
  const mode: ColorMode = usesCurrentColor ? (colors.length ? 'mixed' : 'mono') : colors.length ? 'multi' : 'mono';
  return {
    mode,
    usesCurrentColor: usesCurrentColor || !colors.length,
    colors,
    hasGradient: /<(linear|radial)Gradient\b/i.test(body),
  };
}

/** Removes anything executable. Iconify bodies are clean, but inline SVG is inserted into the DOM. */
export function sanitizeBody(body: string): string {
  return body
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(["']).*?\1/gi, '')
    .replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, '$1#');
}

let idCounter = 0;

/**
 * Gives every id in the body a unique suffix and updates its references, so
 * several inline SVGs with gradients/masks can coexist on one page.
 */
export function uniquifyIds(body: string): string {
  const ids = [...body.matchAll(/\sid\s*=\s*(["'])([^"']+)\1/g)].map((m) => m[2]);
  if (!ids.length) return body;
  const suffix = `-il${(idCounter++).toString(36)}`;
  let result = body;
  // Longest first so "a" doesn't clobber "ab".
  for (const id of [...new Set(ids)].sort((a, b) => b.length - a.length)) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const next = `${id}${suffix}`;
    result = result
      .replace(new RegExp(`(\\sid\\s*=\\s*["'])${escaped}(["'])`, 'g'), `$1${next}$2`)
      .replace(new RegExp(`url\\(\\s*(["']?)#${escaped}\\1\\s*\\)`, 'g'), `url(#${next})`)
      .replace(new RegExp(`(href\\s*=\\s*["'])#${escaped}(["'])`, 'g'), `$1#${next}$2`)
      .replace(new RegExp(`(begin\\s*=\\s*["'][^"']*?)\\b${escaped}\\.`, 'g'), `$1${next}.`);
  }
  return result;
}

/** Replaces currentColor and exact matches from the palette map. */
export function recolorBody(body: string, color: string | null, palette: Record<string, string>): string {
  const map = new Map(Object.entries(palette).map(([from, to]) => [normalizeColor(from), to]));
  const swap = (value: string) => {
    if (color && /^currentColor$/i.test(value.trim())) return color;
    if (map.size && isPaintColor(value)) {
      const replacement = map.get(normalizeColor(value));
      if (replacement) return replacement;
    }
    return value;
  };
  if (!color && !map.size) return body;

  let result = body.replace(ATTR_PATTERN, (_m, lead: string, quote: string, value: string) => `${lead}${quote}${swap(value)}${quote}`);
  result = result.replace(/(style\s*=\s*)(["'])([^"']*)\2/gi, (_m, lead: string, quote: string, css: string) => {
    const next = css.replace(STYLE_PATTERN, (_s, prop: string, value: string) => `${prop}${swap(value)}`);
    return `${lead}${quote}${next}${quote}`;
  });
  return result;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

interface Geometry {
  cx: number;
  cy: number;
  width: number;
  height: number;
  /** transform string for alias-level quarter turns/flips, applied around the icon center */
  intrinsic: string;
}

function iconGeometry(icon: IconData): Geometry {
  const cx = icon.left + icon.width / 2;
  const cy = icon.top + icon.height / 2;
  const quarter = ((icon.rotate ?? 0) % 4 + 4) % 4;
  const sx = icon.hFlip ? -1 : 1;
  const sy = icon.vFlip ? -1 : 1;
  const parts: string[] = [];
  if (quarter || sx < 0 || sy < 0) {
    parts.push(`translate(${round(cx)} ${round(cy)})`);
    if (quarter) parts.push(`rotate(${quarter * 90})`);
    if (sx < 0 || sy < 0) parts.push(`scale(${sx} ${sy})`);
    parts.push(`translate(${round(-cx)} ${round(-cy)})`);
  }
  const swap = quarter % 2 === 1;
  return {
    cx,
    cy,
    width: swap ? icon.height : icon.width,
    height: swap ? icon.width : icon.height,
    intrinsic: parts.join(' '),
  };
}

/** Plain SVG for grids and thumbnails; inherits color from CSS. */
export function iconToSvg(icon: IconData, options: { title?: string } = {}): string {
  const g = iconGeometry(icon);
  const body = uniquifyIds(sanitizeBody(icon.body));
  const vb = `${round(g.cx - g.width / 2)} ${round(g.cy - g.height / 2)} ${round(g.width)} ${round(g.height)}`;
  const content = g.intrinsic ? `<g transform="${g.intrinsic}">${body}</g>` : body;
  const title = options.title ? `<title>${escapeXml(options.title)}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="1em" height="1em" aria-hidden="true" focusable="false">${title}${content}</svg>`;
}

export interface BuildOptions {
  /** Unique ids are required when the markup is inlined in the page. */
  inline?: boolean;
  /** Override the output width/height attributes (e.g. "100%"). */
  displaySize?: string;
}

/** Builds the fully customized, standalone SVG document. */
export function buildCustomSvg(icon: IconData, custom: IconCustomization, options: BuildOptions = {}): string {
  const g = iconGeometry(icon);
  const analysis = analyzeColors(icon.body);
  const clean = sanitizeBody(icon.body);
  const colored = recolorBody(clean, analysis.usesCurrentColor ? custom.color : null, custom.palette);
  const body = options.inline ? uniquifyIds(colored) : colored;

  const box = Math.max(g.width, g.height);
  const pad = (box * Math.min(Math.max(custom.padding, 0), 45)) / 100;
  const total = box + pad * 2;
  const half = total / 2;
  const radius = (total * Math.min(Math.max(custom.radius, 0), 50)) / 100;

  const transform = [
    `translate(${round(half)} ${round(half)})`,
    custom.rotate ? `rotate(${round(custom.rotate)})` : '',
    custom.hFlip || custom.vFlip ? `scale(${custom.hFlip ? -1 : 1} ${custom.vFlip ? -1 : 1})` : '',
    `translate(${round(-g.cx)} ${round(-g.cy)})`,
  ]
    .filter(Boolean)
    .join(' ');

  // Bodies without any paint render black by default; paint them via the wrapper.
  const implicitPaint = analysis.mode === 'mono' && !/currentColor/i.test(clean) ? ` fill="${custom.color}"` : '';
  const inner = g.intrinsic ? `<g transform="${g.intrinsic}">${body}</g>` : body;
  const bg = custom.transparent
    ? ''
    : `<rect width="${round(total)}" height="${round(total)}"${radius ? ` rx="${round(radius)}"` : ''} fill="${custom.background}"/>`;
  const size = options.displaySize ?? String(custom.size);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${round(total)} ${round(total)}">` +
    `${bg}<g transform="${transform}"${implicitPaint}>${inner}</g></svg>`
  );
}

export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Pretty-prints SVG markup for the code panel without altering its content. */
export function formatSvg(svg: string): string {
  const tokens = svg.match(/<[^>]+>|[^<]+/g) ?? [];
  const lines: string[] = [];
  let depth = 0;
  let textOpen = false;
  for (const token of tokens) {
    if (!token.startsWith('<')) {
      if (token.trim() && lines.length) {
        lines[lines.length - 1] += token.trim();
        textOpen = true;
      }
      continue;
    }
    if (token.startsWith('</')) {
      depth = Math.max(0, depth - 1);
      if (textOpen) lines[lines.length - 1] += token;
      else lines.push(`${'  '.repeat(depth)}${token}`);
      textOpen = false;
      continue;
    }
    lines.push(`${'  '.repeat(depth)}${token}`);
    textOpen = false;
    if (!token.endsWith('/>')) depth++;
  }
  return lines.join('\n');
}

export function isValidHex(value: string): boolean {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

/** Converts CSS color strings we can parse into #rrggbb for <input type="color">. */
export function toHex6(value: string): string {
  const v = normalizeColor(value);
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{8}$/.test(v)) return v.slice(0, 7);
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v);
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  if (typeof document !== 'undefined') {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#000000';
      ctx.fillStyle = v;
      const out = String(ctx.fillStyle);
      if (/^#[0-9a-f]{6}$/i.test(out)) return out.toLowerCase();
    }
  }
  return '#000000';
}
