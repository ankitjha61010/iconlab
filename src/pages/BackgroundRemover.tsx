import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ImageDropzone } from '../components/bgremover/ImageDropzone';
import { RemoverPreview, type PickTool, type PreviewStage, type PreviewView, type Selection } from '../components/bgremover/RemoverPreview';
import { RemoverControls, TEXT_FONTS, type RasterFormat, type StyleState } from '../components/bgremover/RemoverControls';
import { useToast } from '../components/common/Toast';
import { useDebounce } from '../hooks/useDebounce';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { useHistory } from '../hooks/useHistory';
import { loadIcon } from '../services/iconifyService';
import {
  ImageLoadError,
  applyFills,
  buildMask,
  countRemoved,
  estimateBackground,
  loadImageFile,
  renderCutout,
  rgbToHex,
  type RemovalOp,
  type RemovalSettings,
  type WorkingImage,
} from '../utils/backgroundRemoval';
import { IDENTITY_TRANSFORM, canvasToBlob, composeImage, contentBounds, hexToRgb, type ComposeOptions, type ImageTransform, type TextItem } from '../utils/imageCompose';
import { buildCustomSvg } from '../utils/svgUtils';
import { inheritTransforms, segmentLayers } from '../utils/imageLayers';
import { svgToRaster } from '../utils/imageExport';
import { downloadBlob } from '../utils/downloadUtils';
import { DEFAULT_CUSTOMIZATION } from '../components/editor/IconEditor';

const DEFAULT_SETTINGS: RemovalSettings = {
  auto: true,
  tolerance: 22,
  contiguous: true,
  smoothing: 35,
  cleanHalo: true,
  removeHoles: true,
  // Letter counters and gaps between fingers are usually well under 0.2% of the
  // image; larger enclosed areas (eye whites in drawings, white lettering inside
  // a shape) are kept by default.
  holeSize: 0.2,
  removeContainer: false,
};
const DEFAULT_STYLE: StyleState = {
  background: '#ffffff',
  transparent: true,
  tintEnabled: false,
  tint: '#000000',
  tintTransparent: false,
  outlineColor: '#000000',
  outlineWidth: 3,
  padding: 0,
  radius: 0,
  trim: false,
  square: false,
  size: null,
  transform: IDENTITY_TRANSFORM,
  elements: [],
  elementGap: 3,
  splits: [],
  texts: [],
};
const SAMPLE_ICON = 'fluent-emoji-flat:rocket';
const MIME: Record<RasterFormat, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

/** Everything undo / redo steps through. */
interface EditorState {
  settings: RemovalSettings;
  ops: RemovalOp[];
  style: StyleState;
}
const INITIAL_STATE: EditorState = { settings: DEFAULT_SETTINGS, ops: [], style: DEFAULT_STYLE };

const textId = (sel: Selection) => (typeof sel === 'string' && sel.startsWith('text:') ? sel.slice(5) : null);
const newTextId = () => Math.random().toString(36).slice(2, 10);

const isTextField = (el: EventTarget | null) =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'color', 'button'].includes(el.type));

interface Loaded {
  image: WorkingImage;
  name: string;
  url: string;
}

/** Builds a sample photo-like input: a real Iconify emoji on a solid backdrop. */
async function createSample(): Promise<File> {
  const icon = await loadIcon(SAMPLE_ICON);
  if (!icon) throw new ImageLoadError('The sample image couldn’t be loaded. Please upload your own image.');
  const svg = buildCustomSvg(icon, { ...DEFAULT_CUSTOMIZATION, transparent: false, background: '#d9efe4', padding: 18, size: 800 });
  const blob = await svgToRaster(svg, { size: 800, format: 'jpeg', background: '#d9efe4', quality: 0.95 });
  return new File([blob], 'sample-rocket.jpg', { type: 'image/jpeg' });
}

export default function BackgroundRemover() {
  useDocumentMeta(
    'Remove Image Background',
    'Remove image backgrounds in your browser, then add a background color, recolor logos and download PNG, JPG or WebP. Nothing is uploaded.',
  );
  const notify = useToast();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const history = useHistory<EditorState>(INITIAL_STATE);
  const { settings, ops, style } = history.state;
  const { set: setState, undo, redo, reset: resetHistory } = history;
  const styleRef = useRef(style);
  useEffect(() => {
    styleRef.current = style;
  }, [style]);

  // Each control gets its own merge group, so dragging one slider is a single undo step.
  const setSettings = useCallback(
    (patch: Partial<RemovalSettings>) => setState((st) => ({ ...st, settings: { ...st.settings, ...patch } }), `settings:${Object.keys(patch).join()}`),
    [setState],
  );
  const setStyle = useCallback(
    (patch: Partial<StyleState>) => setState((st) => ({ ...st, style: { ...st.style, ...patch } }), `style:${Object.keys(patch).join()}`),
    [setState],
  );
  const setTransform = useCallback(
    (patch: Partial<ImageTransform>, group = `transform:${Object.keys(patch).join()}`) =>
      setState((st) => ({ ...st, style: { ...st.style, transform: { ...st.style.transform, ...patch } } }), group),
    [setState],
  );
  const [tool, setTool] = useState<PickTool>('remove');
  /** Edit-tool selection: an element index, the whole image, or nothing. */
  const [selected, setSelected] = useState<Selection>(null);
  const [fillColor, setFillColor] = useState('#5b4cf0');
  const [view, setView] = useState<PreviewView>('result');
  const [stage, setStage] = useState<PreviewStage>('checker');
  const [busy, setBusy] = useState<RasterFormat | 'copy' | null>(null);

  // Slider drags are merged so the (full-resolution) mask isn't rebuilt on every tick.
  const debouncedSettings = useDebounce(settings, 120);
  const processing = debouncedSettings !== settings;

  useEffect(() => () => void (loaded && URL.revokeObjectURL(loaded.url)), [loaded]);

  const openFile = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const image = await loadImageFile(file);
      setLoaded({ image, name: file.name.replace(/\.[^.]+$/, '') || 'image', url: URL.createObjectURL(file) });
      setView('result');
      setSelected(null);
      const detected = estimateBackground(image);
      // A new image starts a fresh history; the look (colors, background) carries over.
      resetHistory({
        settings: { ...DEFAULT_SETTINGS, auto: !!detected },
        ops: [],
        style: { ...styleRef.current, transform: IDENTITY_TRANSFORM, elements: [], splits: [], texts: [] },
      });
    } catch (e) {
      setError(e instanceof ImageLoadError ? e.message : 'We couldn’t open that image. Please try another file.');
    } finally {
      setLoading(false);
    }
  }, [resetHistory]);

  // Undo / redo shortcuts: Ctrl/⌘+Z, Ctrl/⌘+Shift+Z and Ctrl+Y. Text fields keep their own undo.
  useEffect(() => {
    if (!loaded) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || isTextField(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) undo();
      else if ((key === 'z' && e.shiftKey) || key === 'y') redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loaded, undo, redo]);

  // Paste an image from the clipboard anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (file) {
        e.preventDefault();
        void openFile(file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [openFile]);

  const openSample = async () => {
    setLoading(true);
    try {
      await openFile(await createSample());
    } catch (e) {
      setError(e instanceof ImageLoadError ? e.message : 'The sample image couldn’t be loaded.');
      setLoading(false);
    }
  };

  const detected = useMemo(() => (loaded ? estimateBackground(loaded.image) : null), [loaded]);

  const processed = useMemo(() => {
    if (!loaded) return null;
    const mask = buildMask(loaded.image, debouncedSettings, ops, detected);
    const cutout = renderCutout(loaded.image, mask, debouncedSettings);
    applyFills(cutout, loaded.image, ops);
    return { cutout, holes: mask.holes };
  }, [loaded, debouncedSettings, ops, detected]);
  const cutout = processed?.cutout ?? null;

  const bounds = useMemo(() => (cutout ? contentBounds(cutout) : null), [cutout]);

  // Elements (text lines, shapes) are only worked out once someone edits them.
  const needLayers = tool === 'edit' || style.elements.length > 0;
  const layers = useMemo(
    () => (cutout && needLayers ? segmentLayers(cutout, style.elementGap, style.splits) : null),
    [cutout, needLayers, style.elementGap, style.splits],
  );
  // Each element's own edit; elements sitting inside another (a letter's inner fill) follow it unless edited themselves.
  const layerTransforms = useMemo(() => {
    const own: Array<ImageTransform | undefined> = [];
    if (!layers) return own;
    for (const e of style.elements) if (layers.labels[e.anchor] >= 0) own[layers.labels[e.anchor]] = e.transform;
    return inheritTransforms(layers, own);
  }, [layers, style.elements]);
  const selectedLayer =
    typeof selected === 'number' && layers?.layers[selected] && !layerTransforms[selected]?.hidden ? selected : null;
  const selectedText = style.texts.find((t) => t.id === textId(selected)) ?? null;
  const selection: Selection = selectedLayer ?? (selected === 'all' ? 'all' : selectedText ? selected : null);

  const setLayerTransform = useCallback(
    (i: number, patch: Partial<ImageTransform>, group: string | null = `layer:${i}:${Object.keys(patch).join()}`) => {
      if (!layers?.layers[i]) return;
      setState((st) => {
        const at = st.style.elements.findIndex((e) => layers.labels[e.anchor] === i);
        const elements = [...st.style.elements];
        if (at >= 0) elements[at] = { ...elements[at], transform: { ...elements[at].transform, ...patch } };
        // First own edit starts from where it is now (it may be following its parent).
        else elements.push({ anchor: layers.layers[i].anchor, transform: { ...(layerTransforms[i] ?? IDENTITY_TRANSFORM), ...patch } });
        return { ...st, style: { ...st.style, elements } };
      }, group);
    },
    [layers, layerTransforms, setState],
  );

  /** Adds a text (by default in the middle of the canvas) and selects it. `hide` deletes an element in the same undo step. */
  const addText = useCallback(
    (props: Partial<TextItem> = {}, hide?: number) => {
      const item: TextItem = {
        id: newTextId(),
        text: 'Your text',
        x: 0.5,
        y: 0.5,
        size: 0.12,
        rotate: 0,
        color: '#111827',
        font: TEXT_FONTS[0].value,
        bold: true,
        italic: false,
        ...props,
      };
      const hideAnchor = hide !== undefined && layers?.layers[hide] ? hide : null;
      setState((st) => {
        let elements = st.style.elements;
        if (hideAnchor !== null && layers) {
          const at = elements.findIndex((e) => layers.labels[e.anchor] === hideAnchor);
          elements =
            at >= 0
              ? elements.map((e, j) => (j === at ? { ...e, transform: { ...e.transform, hidden: true } } : e))
              : [...elements, { anchor: layers.layers[hideAnchor].anchor, transform: { ...IDENTITY_TRANSFORM, hidden: true } }];
        }
        return { ...st, style: { ...st.style, elements, texts: [...st.style.texts, item] } };
      });
      setTool('edit');
      setSelected(`text:${item.id}`);
    },
    [layers, setState],
  );
  const updateText = useCallback(
    (id: string, patch: Partial<TextItem>, group = `text:${id}:${Object.keys(patch).join()}`) =>
      setState((st) => ({ ...st, style: { ...st.style, texts: st.style.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) } }), group),
    [setState],
  );
  const deleteText = useCallback(
    (id: string) => {
      setState((st) => ({ ...st, style: { ...st.style, texts: st.style.texts.filter((t) => t.id !== id) } }));
      setSelected(null);
    },
    [setState],
  );
  const deleteLayer = useCallback(
    (i: number) => {
      setLayerTransform(i, { hidden: true }, null);
      setSelected(null);
    },
    [setLayerTransform],
  );

  /** Breaks element `i` into its separate letters / shapes and color parts (its own move is dropped). */
  const splitLayer = useCallback(
    (i: number) => {
      const L = layers?.layers[i];
      if (!L || L.splitAnchor != null) return;
      setState((st) => ({
        ...st,
        style: {
          ...st.style,
          splits: [...st.style.splits, L.anchor],
          elements: st.style.elements.filter((e) => layers.labels[e.anchor] !== i),
        },
      }));
      setSelected(null);
    },
    [layers, setState],
  );

  /** Joins the letters of a split element back into one (their own moves are dropped). */
  const joinLayer = useCallback(
    (i: number) => {
      const split = layers?.layers[i]?.splitAnchor;
      if (!layers || split == null) return;
      const letters = new Set(layers.layers.flatMap((L, j) => (L.splitAnchor === split ? [j] : [])));
      setState((st) => ({
        ...st,
        style: {
          ...st.style,
          splits: st.style.splits.filter((a) => a !== split),
          elements: st.style.elements.filter((e) => !letters.has(layers.labels[e.anchor])),
        },
      }));
      setSelected(null);
    },
    [layers, setState],
  );
  const removedPercent = useMemo(() => (cutout ? countRemoved(cutout) : 0), [cutout]);

  const composeOptions = useMemo<ComposeOptions>(
    () => ({
      background: style.transparent ? null : style.background,
      tint: style.tintEnabled ? style.tint : null,
      knockout: style.tintEnabled && style.tintTransparent,
      // Without a background the knockout leaves nothing, so always keep at least a thin outline.
      outline: { color: style.outlineColor, width: style.transparent ? Math.max(1, style.outlineWidth) : style.outlineWidth },
      padding: style.padding,
      radius: style.radius,
      trim: style.trim,
      square: style.square,
      size: style.size,
      transform: style.transform,
      layers,
      layerTransforms,
      texts: style.texts,
    }),
    [style, layers, layerTransforms],
  );

  const outputSize = useMemo(() => {
    if (!cutout || !bounds) return { width: 0, height: 0 };
    const box = style.trim ? bounds : { w: cutout.width, h: cutout.height };
    const pad = (Math.max(box.w, box.h) * style.padding) / 100;
    let w = box.w + pad * 2;
    let h = box.h + pad * 2;
    if (style.square) w = h = Math.max(w, h);
    const scale = style.size ? style.size / Math.max(w, h) : 1;
    return { width: Math.round(w * scale), height: Math.round(h * scale) };
  }, [cutout, bounds, style]);

  const pushOp = (op: RemovalOp) => {
    setState((st) => ({ ...st, ops: [...st.ops, op] }));
    setView('result');
  };

  const onPick = (x: number, y: number) => {
    if (tool === 'remove') pushOp({ kind: 'remove', x, y, tolerance: settings.tolerance, contiguous: settings.contiguous });
    else if (tool === 'restore') pushOp({ kind: 'restore', x, y, tolerance: settings.tolerance });
    else {
      const color = hexToRgb(fillColor);
      if (color) pushOp({ kind: 'fill', x, y, tolerance: settings.tolerance, color });
    }
  };

  const render = (format: RasterFormat) => {
    if (!cutout || !bounds) throw new Error('no image');
    const opts = { ...composeOptions };
    // JPEG has no alpha channel.
    if (format === 'jpeg' && !opts.background) opts.background = '#ffffff';
    const canvas = composeImage(cutout, bounds, opts).canvas;
    if (format !== 'jpeg') return canvas;
    // Flatten onto white so see-through areas (knockout, rounded corners) don't encode as black.
    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const ctx = flat.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(canvas, 0, 0);
    return flat;
  };

  const download = async (format: RasterFormat) => {
    setBusy(format);
    try {
      const blob = await canvasToBlob(render(format), MIME[format], format === 'png' ? undefined : 0.92);
      downloadBlob(blob, `${loaded?.name ?? 'image'}-no-bg.${format === 'jpeg' ? 'jpg' : format}`);
      notify(`${format === 'jpeg' ? 'JPG' : format.toUpperCase()} downloaded`);
    } catch {
      notify('Export failed. Please try again.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    setBusy('copy');
    try {
      if (!('ClipboardItem' in window) || !navigator.clipboard?.write) throw new Error('unsupported');
      const blob = await canvasToBlob(render('png'), 'image/png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      notify('Image copied to clipboard');
    } catch {
      notify('Your browser can’t copy images. Use Download instead.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    setLoaded(null);
    resetHistory(INITIAL_STATE);
    setError(null);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Remove Image Background</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Upload an image, remove its background, then add a background color, recolor it and download. Works best on logos, icons and
          objects on a plain background. Everything runs in your browser.
        </p>
      </div>

      {!loaded || !cutout || !bounds ? (
        <ImageDropzone onFile={openFile} onSample={openSample} busy={loading} error={error} />
      ) : (
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <RemoverPreview
            cutout={cutout}
            bounds={bounds}
            options={composeOptions}
            originalUrl={loaded.url}
            view={view}
            onViewChange={setView}
            stage={stage}
            onStageChange={setStage}
            tool={tool}
            onToolChange={setTool}
            fillColor={fillColor}
            onFillColorChange={setFillColor}
            onPick={onPick}
            onTransform={setTransform}
            selected={selection}
            onSelect={setSelected}
            onTextChange={updateText}
            onAddText={addText}
            onDeleteText={deleteText}
            onDeleteLayer={deleteLayer}
            onLayerTransform={setLayerTransform}
            onSplit={splitLayer}
            onJoin={joinLayer}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={undo}
            onRedo={redo}
            processing={processing}
          />
          <RemoverControls
            settings={settings}
            onSettings={setSettings}
            detectedColor={detected ? rgbToHex(detected) : null}
            removedPercent={removedPercent}
            holes={processed?.holes ?? { removed: 0, kept: 0 }}
            style={style}
            onStyle={setStyle}
            onTransform={setTransform}
            selectedLayer={selectedLayer}
            selectedLayerTransform={selectedLayer !== null ? (layerTransforms[selectedLayer] ?? IDENTITY_TRANSFORM) : null}
            onSelectedLayerTransform={(patch) => selectedLayer !== null && setLayerTransform(selectedLayer, patch)}
            onDeselect={() => setSelected(null)}
            selectedText={selectedText}
            onTextChange={(patch) => selectedText && updateText(selectedText.id, patch)}
            onAddText={() => addText()}
            onDeleteText={() => selectedText && deleteText(selectedText.id)}
            deletedCount={layerTransforms.filter((t) => t?.hidden).length}
            onStartEditing={() => setTool('edit')}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            editCount={ops.length}
            onUndo={undo}
            onRedo={redo}
            onResetEdits={() => setState((st) => ({ ...st, ops: [] }))}
            outputSize={outputSize}
            onDownload={download}
            onCopy={copy}
            onNewImage={reset}
            busy={busy}
          />
        </div>
      )}
    </div>
  );
}
