import { type JSX, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Bandage,
  Eraser,
  Grid3x3,
  Group,
  Moon,
  Move,
  PaintBucket,
  Paintbrush,
  Redo2,
  RotateCcw,
  Square,
  Sun,
  Trash2,
  Type,
  Undo2,
  Ungroup,
} from 'lucide-react';
import {
  IDENTITY_TRANSFORM,
  alignLayer,
  composeImage,
  hitTest,
  layerBox,
  screenToLayerDelta,
  fromSourcePoint,
  toBasePoint,
  toSourcePoint,
  type Align,
  type Bounds,
  type ComposeLayout,
  type ComposeOptions,
  type ImageTransform,
  type TextItem,
} from '../../utils/imageCompose';
import { inkColor, linePieces } from '../../utils/fontMatch';
import type { LayerSet } from '../../utils/imageLayers';

export type PreviewStage = 'checker' | 'grid' | 'light' | 'dark';
/** 'edit' moves / resizes / rotates the subject; 'heal' is a brush; the others are click-a-region tools. */
export type PickTool = 'edit' | 'remove' | 'restore' | 'fill' | 'heal';
export type PreviewView = 'result' | 'original';
/** Fill tool: one part of the image, or the similar color around the click. */
export type FillMode = 'part' | 'color';

const STAGES = [
  { value: 'checker', label: 'Transparency grid', icon: <Square size={15} />, className: 'stage-checker' },
  { value: 'grid', label: 'Pixel grid', icon: <Grid3x3 size={15} />, className: 'stage-grid' },
  { value: 'light', label: 'Light background', icon: <Sun size={15} />, className: 'bg-white' },
  { value: 'dark', label: 'Dark background', icon: <Moon size={15} />, className: 'bg-[#14152b]' },
] as const;

const PREVIEW_SIZE = 1000;
/** Small uploads are scaled up to at least this size so they aren't a thumbnail in the stage. */
const MIN_PREVIEW_SIZE = 560;

interface RemoverPreviewProps {
  cutout: ImageData;
  bounds: Bounds;
  options: ComposeOptions;
  originalUrl: string;
  view: PreviewView;
  onViewChange: (view: PreviewView) => void;
  stage: PreviewStage;
  onStageChange: (stage: PreviewStage) => void;
  tool: PickTool;
  onToolChange: (tool: PickTool) => void;
  fillColor: string;
  onFillColorChange: (color: string) => void;
  fillMode: FillMode;
  onFillModeChange: (mode: FillMode) => void;
  /** The image split into parts, while filling by part (for the highlight under the pointer). */
  fillParts: LayerSet | null;
  onPick: (x: number, y: number) => void;
  /** A finished heal-brush stroke: x, y pairs and the brush radius, in source px. */
  onHeal: (points: number[], radius: number) => void;
  /** `group` merges a whole drag gesture into one undo step. */
  onTransform: (patch: Partial<ImageTransform>, group?: string) => void;
  /** Edit-tool selection: an element (text line, shape) index, the whole image, an added text, or nothing. */
  selected: Selection;
  onSelect: (target: Selection) => void;
  onLayerTransform: (i: number, patch: Partial<ImageTransform>, group?: string) => void;
  onDeleteLayer: (i: number) => void;
  onTextChange: (id: string, patch: Partial<TextItem>, group?: string) => void;
  /** Adds a text; with `hide`, element `hide` is deleted in the same step (replace). */
  /** `hide`: elements the text replaces, deleted in the same undo step. */
  onAddText: (props?: Partial<TextItem>, hide?: number[]) => void;
  onDeleteText: (id: string) => void;
  /** Break an element into its separate letters / shapes, or join split letters back. */
  onSplit: (i: number) => void;
  onJoin: (i: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  processing: boolean;
}

const TOOLS = [
  { value: 'edit', label: 'Edit image', title: 'Move, resize and rotate the image', icon: <Move size={14} aria-hidden="true" /> },
  { value: 'remove', label: 'Erase area', title: 'Click an area to remove it', icon: <Eraser size={14} aria-hidden="true" /> },
  { value: 'restore', label: 'Restore area', title: 'Click an area to bring it back', icon: <Paintbrush size={14} aria-hidden="true" /> },
  { value: 'fill', label: 'Fill area', title: 'Click an area to fill it with a color', icon: <PaintBucket size={14} aria-hidden="true" /> },
  { value: 'heal', label: 'Heal brush', title: 'Paint over anything to replace it with the background around it', icon: <Bandage size={14} aria-hidden="true" /> },
] as const;

const TIPS: Record<PickTool, string> = {
  edit: 'Click a text or shape to select it, then drag to move, drag a corner to resize or the round handle to rotate (Shift snaps to 15°). Double-click a word to move its letters one by one. Del deletes the selection; “Replace with text” swaps it for your own text. Use “Whole image” to move everything; Esc deselects.',
  remove: 'Click any leftover background to erase it.',
  restore: 'Click a part that was removed by mistake to bring it back.',
  fill: 'One part: the part under the pointer is highlighted; click to fill just it. Similar color: fills everything of a similar color touching the click.',
  heal: 'Paint over anything you want gone (a label, an icon, a shadow). It’s replaced by the background around it: plain colors stay plain, gradients carry on.',
};

const CORNERS = [
  { key: 'nw', className: '-left-1.5 -top-1.5 cursor-nwse-resize' },
  { key: 'ne', className: '-right-1.5 -top-1.5 cursor-nesw-resize' },
  { key: 'sw', className: '-bottom-1.5 -left-1.5 cursor-nesw-resize' },
  { key: 'se', className: '-bottom-1.5 -right-1.5 cursor-nwse-resize' },
] as const;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const normalizeAngle = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;
let gestureId = 0;

export type Selection = number | 'all' | `text:${string}` | null;
type Target = Exclude<Selection, null>;
const textIdOf = (t: Selection) => (typeof t === 'string' && t.startsWith('text:') ? t.slice(5) : null);

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: number;
}

const ALIGNS: Array<{ value: Align; label: string; icon: JSX.Element }> = [
  { value: 'left', label: 'Align left', icon: <AlignStartVertical size={15} /> },
  { value: 'center', label: 'Align center', icon: <AlignCenterVertical size={15} /> },
  { value: 'right', label: 'Align right', icon: <AlignEndVertical size={15} /> },
  { value: 'top', label: 'Align top', icon: <AlignStartHorizontal size={15} /> },
  { value: 'middle', label: 'Align middle', icon: <AlignCenterHorizontal size={15} /> },
  { value: 'bottom', label: 'Align bottom', icon: <AlignEndHorizontal size={15} /> },
];

/** Is output point `p` inside the (rotated) box? */
function insideBox(b: Box, px: number, py: number) {
  const dx = px - b.x;
  const dy = py - b.y;
  const cos = Math.cos(-b.rotate);
  const sin = Math.sin(-b.rotate);
  return Math.abs(dx * cos - dy * sin) <= b.w / 2 && Math.abs(dx * sin + dy * cos) <= b.h / 2;
}

export function RemoverPreview(props: RemoverPreviewProps) {
  const { cutout, bounds, options, originalUrl, view, stage, tool, onPick, onTransform, onLayerTransform, onTextChange, onSelect, selected, processing } =
    props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [layout, setLayout] = useState<ComposeLayout | null>(null);
  const transform = options.transform ?? IDENTITY_TRANSFORM;
  /** Heal brush diameter in screen px, the stroke being painted and the pointer (both relative to the canvas, screen px). */
  const [brushSize, setBrushSize] = useState(24);
  const [stroke, setStroke] = useState<number[] | null>(null);
  const [brushAt, setBrushAt] = useState<{ x: number; y: number } | null>(null);
  // Redraw once web fonts finish loading, so added text doesn't stay in a fallback font.
  const [fontsLoaded, setFontsLoaded] = useState(0);
  useEffect(() => {
    const onLoaded = () => setFontsLoaded((n) => n + 1);
    document.fonts.addEventListener('loadingdone', onLoaded);
    return () => document.fonts.removeEventListener('loadingdone', onLoaded);
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    const longest = Math.max(cutout.width, cutout.height);
    // Render the canvas with a transparent background — the background colour
    // is shown via the stage div (filling the entire preview area). A knockout
    // needs the real background on the canvas so the cut-out shape shows
    // through to the checkerboard. We also skip the corner-radius clip here;
    // it only matters on export.
    const { layout } = composeImage(
      cutout,
      bounds,
      {
        ...options,
        background: options.knockout ? options.background : null,
        radius: 0, // no clipping in preview; applied only on export
        size: Math.min(PREVIEW_SIZE, Math.max(MIN_PREVIEW_SIZE, longest)),
      },
      canvasRef.current,
    );
    setLayout(layout);
  }, [cutout, bounds, options, fontsLoaded]);

  const editing = tool === 'edit' && view === 'result' && layout !== null;

  const { onDeleteLayer, onDeleteText } = props;
  // Esc drops the selection; Delete / Backspace removes the selected element or text.
  useEffect(() => {
    if (!editing || selected === null) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onSelect(null);
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const id = textIdOf(selected);
      if (typeof selected === 'number') onDeleteLayer(selected);
      else if (id) onDeleteText(id);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, selected, onSelect, onDeleteLayer, onDeleteText]);

  /** Pointer position in output-canvas px. */
  const canvasPoint = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: ((clientX - rect.left) / rect.width) * layout!.width, y: ((clientY - rect.top) / rect.height) * layout!.height, rect };
  };

  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (tool === 'edit' || tool === 'heal' || !layout) return;
    const p = canvasPoint(e.clientX, e.clientY);
    const { x, y } = toSourcePoint(layout, p.x, p.y);
    if (x >= 0 && y >= 0 && x < cutout.width && y < cutout.height) onPick(x, y);
  };

  /** Heal brush: paint a stroke while the button is down, then hand it over in source px. */
  const onBrushDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (tool !== 'heal' || !layout || e.button !== 0) return;
    e.preventDefault();
    const canvas = e.currentTarget;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const points = [e.clientX - rect.left, e.clientY - rect.top];
    setStroke([...points]);
    const onMove = (ev: PointerEvent) => {
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      // Skip points closer than a few px; the stroke is drawn with round joins anyway.
      if (Math.hypot(x - points[points.length - 2], y - points[points.length - 1]) < Math.max(2, brushSize / 6)) return;
      points.push(x, y);
      setStroke([...points]);
    };
    const onUp = () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      setStroke(null);
      const toOutput = layout.width / rect.width;
      const source: number[] = [];
      for (let k = 0; k < points.length; k += 2) {
        const p = toBasePoint(layout, points[k] * toOutput, points[k + 1] * toOutput);
        source.push(p.x, p.y);
      }
      // The radius in source px: how far a brush-radius step on screen goes in the image.
      const a = toBasePoint(layout, points[0] * toOutput, points[1] * toOutput);
      const b = toBasePoint(layout, (points[0] + brushSize / 2) * toOutput, points[1] * toOutput);
      props.onHeal(source, Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)));
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
  };
  const onBrushHover = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (tool === 'fill') return onFillHover(e);
    if (tool !== 'heal') return;
    const rect = e.currentTarget.getBoundingClientRect();
    setBrushAt({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  /** Fill by part: which part is under the pointer (it's highlighted, and a click fills just it). */
  const [hoverPart, setHoverPart] = useState(-1);
  const partsRef = useRef<HTMLCanvasElement>(null);
  const { fillParts } = props;
  const onFillHover = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!layout || !fillParts) return setHoverPart(-1);
    const p = canvasPoint(e.clientX, e.clientY);
    const s = toSourcePoint(layout, p.x, p.y);
    const x = Math.floor(s.x);
    const y = Math.floor(s.y);
    const part = x >= 0 && y >= 0 && x < fillParts.width && y < fillParts.height ? fillParts.labels[y * fillParts.width + x] : -1;
    setHoverPart(part);
  };
  // Tint the hovered part on an overlay, placed exactly over the artwork.
  useEffect(() => {
    const overlay = partsRef.current;
    if (!overlay || !layout) return;
    overlay.width = layout.width;
    overlay.height = layout.height;
    const ctx = overlay.getContext('2d')!;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const L = fillParts?.layers[hoverPart];
    if (!fillParts || !L) return;
    const mask = new ImageData(L.w, L.h);
    for (let y = 0; y < L.h; y++) {
      for (let x = 0; x < L.w; x++) {
        if (fillParts.labels[(L.y + y) * fillParts.width + L.x + x] !== hoverPart) continue;
        const q = (y * L.w + x) * 4;
        mask.data.set([91, 76, 240, 110], q);
      }
    }
    const piece = document.createElement('canvas');
    piece.width = L.w;
    piece.height = L.h;
    piece.getContext('2d')!.putImageData(mask, 0, 0);
    // Source px → output px is affine: read it off three mapped points.
    const o = fromSourcePoint(layout, 0, 0);
    const ax = fromSourcePoint(layout, 1, 0);
    const ay = fromSourcePoint(layout, 0, 1);
    ctx.setTransform(ax.x - o.x, ax.y - o.y, ay.x - o.x, ay.y - o.y, o.x, o.y);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(piece, L.x, L.y);
  }, [hoverPart, fillParts, layout]);

  const textOf = (target: Target) => {
    const id = textIdOf(target);
    return id ? (options.texts?.find((t) => t.id === id) ?? null) : null;
  };
  const boxOf = (target: Target): Box => {
    if (typeof target === 'number') return layerBox(layout!, target);
    const id = textIdOf(target);
    if (id) return layout!.texts.find((t) => t.id === id) ?? { x: 0, y: 0, w: 0, h: 0, rotate: 0 };
    const k = layout!.subjectW / layout!.box.w;
    let ox = (bounds.x + bounds.w / 2 - (layout!.box.x + layout!.box.w / 2)) * k;
    let oy = (bounds.y + bounds.h / 2 - (layout!.box.y + layout!.box.h / 2)) * k;
    if (layout!.flipX) ox = -ox;
    if (layout!.flipY) oy = -oy;
    const cos = Math.cos(layout!.rotate);
    const sin = Math.sin(layout!.rotate);
    return { x: layout!.centerX + ox * cos - oy * sin, y: layout!.centerY + ox * sin + oy * cos, w: bounds.w * k, h: bounds.h * k, rotate: layout!.rotate };
  };
  /** Position / size / angle of any target in one shape; for texts `zoom` is the font size. */
  const transformOf = (target: Target): ImageTransform => {
    if (typeof target === 'number') return layout?.layerTransforms[target] ?? IDENTITY_TRANSFORM;
    const text = textOf(target);
    if (text) return { ...IDENTITY_TRANSFORM, x: text.x, y: text.y, zoom: text.size, rotate: text.rotate };
    return transform;
  };
  const apply = (target: Target, patch: Partial<ImageTransform>, group?: string) => {
    if (typeof target === 'number') return onLayerTransform(target, patch, group);
    const id = textIdOf(target);
    if (!id) return onTransform(patch, group);
    const { zoom, ...rest } = patch;
    const t: Partial<TextItem> = {};
    if (rest.x !== undefined) t.x = rest.x;
    if (rest.y !== undefined) t.y = rest.y;
    if (rest.rotate !== undefined) t.rotate = rest.rotate;
    if (zoom !== undefined) t.size = zoom;
    onTextChange(id, t, group);
  };
  /** Whole image and texts are positioned in canvas fractions; elements in source px. */
  const inFractions = (target: Target) => typeof target !== 'number';

  /** Lines a text up with an edge or the center of the canvas. */
  const alignText = (target: Target, align: Align): Partial<ImageTransform> => {
    const b = boxOf(target);
    const ex = (Math.abs(b.w * Math.cos(b.rotate)) + Math.abs(b.h * Math.sin(b.rotate))) / 2 / layout!.width;
    const ey = (Math.abs(b.w * Math.sin(b.rotate)) + Math.abs(b.h * Math.cos(b.rotate))) / 2 / layout!.height;
    const at = { left: { x: ex }, center: { x: 0.5 }, right: { x: 1 - ex }, top: { y: ey }, middle: { y: 0.5 }, bottom: { y: 1 - ey } };
    return at[align];
  };

  /** Deletes element `i` and puts editable text in its place, matching its position, angle, size and color. */
  /** Deletes element `i` — with the rest of its line of letters — and puts editable text in its place, matching its position, angle, size and color. */
  const replaceWithText = (i: number) => {
    const set = layout?.layers;
    if (!layout || !set) return;
    const line = linePieces(cutout, set, i).filter((j) => !layout.layerTransforms[j]?.hidden);
    const boxes = line.map((j) => layerBox(layout, j));
    const x0 = Math.min(...boxes.map((b) => b.x - b.w / 2));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w / 2));
    // Size and height from the tallest letters (capitals, digits), not ascenders plus descenders.
    const tallest = Math.max(...boxes.map((b) => b.h));
    const caps = boxes.filter((b) => b.h >= tallest * 0.8);
    const capH = caps.reduce((sum, b) => sum + b.h, 0) / caps.length;
    const cy = caps.reduce((sum, b) => sum + b.y, 0) / caps.length;
    props.onAddText(
      {
        text: 'New text',
        x: (x0 + x1) / 2 / layout.width,
        y: cy / layout.height,
        // Capitals are roughly 0.72 of the font size tall.
        size: clamp(capH / 0.72 / layout.height, 0.02, 0.8),
        rotate: Math.round((layerBox(layout, i).rotate * 180) / Math.PI),
        color: inkColor(cutout, set, line),
      },
      line,
    );
  };

  /** Drag handling: move the body, resize from corners, rotate from the top handle. */
  const startGesture = (mode: 'move' | 'scale' | 'rotate', target: Target, e: ReactPointerEvent<HTMLElement>) => {
    if (!layout || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const { rect } = canvasPoint(e.clientX, e.clientY);
    const toOutput = layout.width / rect.width;
    const box = boxOf(target);
    const cx = rect.left + box.x / toOutput;
    const cy = rect.top + box.y / toOutput;
    const start = { ...transformOf(target) };
    const startLayout = layout;
    const startDist = Math.max(1, Math.hypot(e.clientX - cx, e.clientY - cy));
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
    // An element inside a flipped image turns the other way on screen.
    const spin = typeof target === 'number' && layout.flipX !== layout.flipY ? -1 : 1;
    const isText = textIdOf(target) !== null;
    const group = `@gesture:${++gestureId}`;

    const onMove = (ev: PointerEvent) => {
      if (mode === 'move') {
        const dx = ev.clientX - e.clientX;
        const dy = ev.clientY - e.clientY;
        if (inFractions(target)) {
          const [lo, hi] = isText ? [0, 1] : [-1, 1];
          apply(target, { x: clamp(start.x + dx / rect.width, lo, hi), y: clamp(start.y + dy / rect.height, lo, hi) }, group);
        } else {
          const d = screenToLayerDelta(startLayout, dx * toOutput, dy * toOutput);
          apply(target, { x: start.x + d.x, y: start.y + d.y }, group);
        }
      } else if (mode === 'scale') {
        const dist = Math.hypot(ev.clientX - cx, ev.clientY - cy);
        apply(target, { zoom: isText ? clamp(start.zoom * (dist / startDist), 0.01, 1) : clamp(start.zoom * (dist / startDist), 0.1, 4) }, group);
      } else {
        const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx);
        let rotate = start.rotate + (spin * (angle - startAngle) * 180) / Math.PI;
        rotate = ev.shiftKey ? Math.round(rotate / 15) * 15 : Math.round(rotate);
        apply(target, { rotate: normalizeAngle(rotate) }, group);
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  /**
   * The element at an output point: the one whose pixels are there, else the
   * smallest element box around it (so the gaps in and between thin letters
   * still pick the letter / word), else −1.
   */
  const visibleLayer = (i: number) => layout?.layers?.layers[i]?.selectable && !layout.layerTransforms[i]?.hidden;
  const pickLayer = (x: number, y: number) => {
    const set = layout?.layers;
    if (!set) return -1;
    const hit = hitTest(layout, x, y).layer;
    if (hit >= 0 && visibleLayer(hit)) return wordFirst(hit);
    let best = -1;
    let bestArea = Infinity;
    set.layers.forEach((_, i) => {
      if (!visibleLayer(i)) return;
      const b = boxOf(i);
      if (b.w * b.h < bestArea && insideBox(b, x, y)) {
        best = i;
        bestArea = b.w * b.h;
      }
    });
    return best >= 0 ? wordFirst(best) : best;
  };
  /** A letter of a word picks the whole word first; once that word (or one of its letters) is selected, the letter. */
  const wordFirst = (i: number) => {
    const set = layout?.layers;
    const w = set?.layers[i]?.parent;
    if (!set || w == null || !set.layers[w]?.word || !visibleLayer(w)) return i;
    const inWord = selected === w || (typeof selected === 'number' && set.layers[selected]?.parent === w);
    return inWord ? i : w;
  };

  /** Edit tool: pick what's under the pointer and start dragging it straight away. Elements always win over the whole image. */
  const onCanvasPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (!editing || e.button !== 0) return;
    const p = canvasPoint(e.clientX, e.clientY);
    // Added texts sit on top, so they are picked first (last drawn first).
    const text = [...layout.texts].reverse().find((t) => insideBox(t, p.x, p.y));
    if (text) {
      onSelect(`text:${text.id}`);
      return startGesture('move', `text:${text.id}`, e);
    }
    const hit = pickLayer(p.x, p.y);
    if (hit >= 0) {
      onSelect(hit);
      return startGesture('move', hit, e);
    }
    if (selected === 'all' && insideBox(boxOf('all'), p.x, p.y)) return startGesture('move', 'all', e);
    onSelect(null);
  };

  /** Double-click drills into an element: its letters / shapes become separately movable. */
  const onDoubleClick = (e: MouseEvent<HTMLElement>) => {
    if (!editing) return;
    const p = canvasPoint(e.clientX, e.clientY);
    if (layout.texts.some((t) => insideBox(t, p.x, p.y))) return document.getElementById('text-content')?.focus();
    const hit = pickLayer(p.x, p.y);
    if (hit >= 0 && layout.layers?.layers[hit]?.splitAnchor == null) props.onSplit(hit);
  };

  const onKeyNudge = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!editing || selected === null) return;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    const px = (e.shiftKey ? 0.05 : 0.005) * layout.width;
    const t = transformOf(selected);
    if (inFractions(selected)) {
      apply(selected, { x: clamp(t.x + (move[0] * px) / layout.width, -1, 1), y: clamp(t.y + (move[1] * px) / layout.height, -1, 1) }, `${selected}:nudge`);
    } else {
      const d = screenToLayerDelta(layout, move[0] * px, move[1] * px);
      apply(selected, { x: t.x + d.x, y: t.y + d.y }, `layer:${selected}:nudge`);
    }
  };

  const stageClass = STAGES.find((s) => s.value === stage)!.className;

  // When a solid background colour is chosen, override the stage background so
  // the chosen colour fills the *entire* preview area behind the transparent canvas.
  const hasBackground = Boolean(options.background) && !options.knockout;
  const stageStyle = hasBackground ? { backgroundColor: options.background as string } : undefined;
  // Outlines: the main elements, plus the letters of a selected word (or of the word a selected letter is in).
  const set = layout?.layers;
  const openWord = typeof selected === 'number' && set ? (set.layers[selected]?.word ? selected : set.layers[selected]?.parent) : null;
  const outlined =
    editing && set
      ? set.layers.flatMap((L, i) => ((L.outlined || (openWord != null && L.parent === openWord)) && visibleLayer(i) ? [i] : []))
      : [];
  const selectedText = selected !== null ? textOf(selected) : null;

  const boxStyle = (b: Box) => ({
    left: `${(b.x / layout!.width) * 100}%`,
    top: `${(b.y / layout!.height) * 100}%`,
    width: `${(b.w / layout!.width) * 100}%`,
    height: `${(b.h / layout!.height) * 100}%`,
    transform: `translate(-50%, -50%) rotate(${b.rotate}rad)`,
  });

  const renderSelection = (target: Target) => (
    <div key={`sel-${target}`} className="pointer-events-none absolute border-2 border-dashed border-primary" style={boxStyle(boxOf(target))}>
      {CORNERS.map((c) => (
        <span
          key={c.key}
          onPointerDown={(e) => startGesture('scale', target, e)}
          className={`pointer-events-auto absolute h-3 w-3 touch-none rounded-sm border-2 border-primary bg-white shadow ${c.className}`}
          aria-hidden="true"
        />
      ))}
      <span className="absolute -top-7 left-1/2 h-5 w-0 -translate-x-1/2 border-l-2 border-dashed border-primary" aria-hidden="true" />
      <span
        onPointerDown={(e) => startGesture('rotate', target, e)}
        title="Drag to rotate"
        className="pointer-events-auto absolute -top-9 left-1/2 h-4 w-4 -translate-x-1/2 cursor-grab touch-none rounded-full border-2 border-primary bg-white shadow active:cursor-grabbing"
        aria-hidden="true"
      />
    </div>
  );

  const toggle = (active: boolean) =>
    `inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors ${
      active ? 'bg-primary-soft text-primary shadow-soft ring-1 ring-inset ring-primary/40' : 'text-muted hover:bg-surface hover:text-text'
    }`;
  const iconToggle = (active: boolean) =>
    `inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-40 ${
      active ? 'bg-primary-soft text-primary shadow-soft ring-1 ring-inset ring-primary/40' : 'text-muted hover:bg-surface hover:text-text'
    }`;

  return (
    <section aria-label="Image preview" className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:px-4">
        <div className="flex gap-2">
          <div className="flex gap-1 rounded-lg bg-surface-2 p-1" role="radiogroup" aria-label="Compare">
            {(['result', 'original'] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => props.onViewChange(v)} className={toggle(view === v)}>
                {v === 'result' ? 'Result' : 'Original'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-surface-2 p-1">
            <button type="button" onClick={props.onUndo} disabled={!props.canUndo} aria-label="Undo" title="Undo (Ctrl/⌘+Z)" className={iconToggle(false)}>
              <Undo2 size={15} />
            </button>
            <button type="button" onClick={props.onRedo} disabled={!props.canRedo} aria-label="Redo" title="Redo (Ctrl/⌘+Shift+Z)" className={iconToggle(false)}>
              <Redo2 size={15} />
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg bg-surface-2 p-1" role="radiogroup" aria-label="Tool">
          {TOOLS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={tool === t.value}
              onClick={() => props.onToolChange(t.value)}
              className={toggle(tool === t.value)}
              title={t.title}
            >
              {t.icon} {t.label}
            </button>
          ))}
          {tool === 'heal' && (
            <label className="my-auto ml-1 flex items-center gap-1.5 text-xs text-muted" title="Brush size">
              Size
              <input
                type="range"
                min={4}
                max={120}
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                aria-label="Brush size"
                className="w-20"
              />
            </label>
          )}
          {tool === 'fill' && (
            <div className="my-auto ml-1 flex rounded-md bg-surface p-0.5" role="radiogroup" aria-label="Fill what">
              {(
                [
                  ['part', 'One part', 'Fill just the part you click (a letter, a shape, a card)'],
                  ['color', 'Similar color', 'Fill everything of a similar color that touches the click'],
                ] as const
              ).map(([value, label, title]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={props.fillMode === value}
                  title={title}
                  onClick={() => props.onFillModeChange(value)}
                  className={`h-6 rounded px-2 text-xs font-medium transition-colors ${
                    props.fillMode === value ? 'bg-primary-soft text-primary' : 'text-muted hover:text-text'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {tool === 'fill' && (
            <label
              className="relative my-auto ml-1 h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded-full border border-border"
              style={{ backgroundColor: props.fillColor }}
              title="Fill color"
            >
              <input
                type="color"
                value={props.fillColor}
                onChange={(e) => props.onFillColorChange(e.target.value)}
                aria-label="Fill color"
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
          )}
        </div>
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1" role="radiogroup" aria-label="Preview background">
          {STAGES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={stage === s.value}
              aria-label={s.label}
              title={s.label}
              onClick={() => props.onStageChange(s.value)}
              className={iconToggle(stage === s.value)}
            >
              {s.icon}
            </button>
          ))}
        </div>
      </div>

      {/* Stage area — background colour fills the full area so it's not just around the image edges */}
      <div
        className={`relative flex min-h-[360px] items-center justify-center overflow-hidden px-4 pb-4 pt-12 sm:min-h-[480px] sm:p-12 ${hasBackground ? '' : stageClass}`}
        style={stageStyle}
        onPointerDown={(e) => editing && e.target === e.currentTarget && onSelect(null)}
      >
        {editing && (
          <div
            className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-soft"
            role="toolbar"
            aria-label="Selection"
          >
            <button
              type="button"
              aria-pressed={selected === 'all'}
              onClick={() => onSelect(selected === 'all' ? null : 'all')}
              title="Move, resize or rotate everything together"
              className={`${toggle(selected === 'all')} h-7`}
            >
              <Square size={14} aria-hidden="true" /> Whole image
            </button>
            <button type="button" onClick={() => props.onAddText()} title="Add new text" className={`${toggle(false)} h-7`}>
              <Type size={14} aria-hidden="true" /> Add text
            </button>
            {selectedText && (
              <>
                <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
                <input
                  value={selectedText.text}
                  onChange={(e) => onTextChange(selectedText.id, { text: e.target.value })}
                  aria-label="Text"
                  className="h-7 w-36 rounded-md border border-border bg-surface px-2 text-xs outline-none focus:border-primary"
                />
                <label
                  className="relative mx-1 h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded-full border border-border"
                  style={{ backgroundColor: selectedText.color }}
                  title="Text color"
                >
                  <input
                    type="color"
                    value={selectedText.color}
                    onChange={(e) => onTextChange(selectedText.id, { color: e.target.value })}
                    aria-label="Text color"
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </label>
              </>
            )}
            {selected !== null && selected !== 'all' && (
              <>
                <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
                {ALIGNS.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    onClick={() => apply(selected, typeof selected === 'number' ? alignLayer(layout, selected, a.value) : alignText(selected, a.value))}
                    aria-label={a.label}
                    title={a.label}
                    className={iconToggle(false)}
                  >
                    {a.icon}
                  </button>
                ))}
                <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
                {selectedText && (
                  <button
                    type="button"
                    onClick={() => props.onDeleteText(selectedText.id)}
                    aria-label="Delete text"
                    title="Delete text (Del)"
                    className={`${iconToggle(false)} hover:text-danger`}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </>
            )}
            {typeof selected === 'number' && (
              <>
                {layout.layers?.layers[selected]?.splitAnchor == null && (
                  <button
                    type="button"
                    onClick={() => props.onSplit(selected)}
                    title="Split into letters and color parts — move each one separately"
                    className={`${toggle(false)} h-7`}
                  >
                    <Ungroup size={15} aria-hidden="true" /> Split letters
                  </button>
                )}
                {layout.layers?.layers[selected]?.splitAnchor != null && (
                  <button
                    type="button"
                    onClick={() => props.onJoin(selected)}
                    title="Join these letters back into one element"
                    className={`${toggle(false)} h-7`}
                  >
                    <Group size={15} aria-hidden="true" /> Join letters
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => replaceWithText(selected)}
                  title="Delete this and type new text in its place"
                  className={`${toggle(false)} h-7`}
                >
                  <Type size={15} aria-hidden="true" /> Replace with text
                </button>
                <button
                  type="button"
                  onClick={() => apply(selected, IDENTITY_TRANSFORM)}
                  aria-label="Put element back"
                  title="Put element back"
                  className={iconToggle(false)}
                >
                  <RotateCcw size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => props.onDeleteLayer(selected)}
                  aria-label="Delete element"
                  title="Delete element (Del)"
                  className={`${iconToggle(false)} hover:text-danger`}
                >
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </div>
        )}
        <div
          className={`relative max-w-full outline-none ${view === 'original' ? 'hidden' : ''}`}
          onPointerDown={onCanvasPointerDown}
          onDoubleClick={onDoubleClick}
          onKeyDown={onKeyNudge}
          tabIndex={editing ? 0 : -1}
          aria-label={editing ? 'Image editor. Click a text or shape to select it; arrow keys move the selection.' : undefined}
        >
          <canvas
            ref={canvasRef}
            onClick={onClick}
            onPointerDown={onBrushDown}
            onPointerMove={onBrushHover}
            onPointerLeave={() => {
              setBrushAt(null);
              setHoverPart(-1);
            }}
            className={`block max-h-[70vh] max-w-full touch-none object-contain ${editing ? 'cursor-move outline-1 outline-dashed outline-border-strong' : tool === 'heal' ? 'cursor-none' : 'cursor-crosshair'}`}
            role="img"
            aria-label={
              tool === 'edit'
                ? 'Result preview.'
                : tool === 'heal'
                  ? 'Result preview. Paint over anything to replace it with the background around it.'
                  : `Result preview. Click to ${tool === 'remove' ? 'erase' : tool} a region.`
            }
          />
          {tool === 'fill' && fillParts && (
            <canvas ref={partsRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />
          )}
          {tool === 'heal' && (stroke || brushAt) && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
              {stroke && (
                <polyline
                  points={stroke.join(' ')}
                  fill="none"
                  stroke="var(--primary)"
                  strokeOpacity={0.45}
                  strokeWidth={brushSize}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {brushAt && (
                <circle cx={brushAt.x} cy={brushAt.y} r={brushSize / 2} fill="none" stroke="var(--primary)" strokeWidth={1.5} />
              )}
            </svg>
          )}
          {editing && selected !== 'all' &&
            outlined.map(
              (i) =>
                i !== selected && (
                  <div
                    key={i}
                    className="pointer-events-none absolute border border-dashed border-primary/60"
                    style={boxStyle(boxOf(i))}
                    aria-hidden="true"
                  />
                ),
            )}
          {editing &&
            selected !== 'all' &&
            layout.texts.map(
              (t) =>
                `text:${t.id}` !== selected && (
                  <div key={t.id} className="pointer-events-none absolute border border-dashed border-primary/60" style={boxStyle(t)} aria-hidden="true" />
                ),
            )}
          {editing && selected !== null && renderSelection(selected)}
        </div>
        {view === 'original' && <img src={originalUrl} alt="Original upload" className="max-h-[70vh] max-w-full object-contain" />}
        {processing && (
          <span className="absolute right-3 top-3 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">Processing…</span>
        )}
      </div>
      <p className="border-t border-border px-4 py-2.5 text-xs text-muted">Tip: {TIPS[tool]}</p>
    </section>
  );
}
