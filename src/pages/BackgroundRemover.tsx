import { useCallback, useEffect, useMemo, useState } from 'react';
import { ImageDropzone } from '../components/bgremover/ImageDropzone';
import { RemoverPreview, type PickTool, type PreviewStage, type PreviewView } from '../components/bgremover/RemoverPreview';
import { RemoverControls, type RasterFormat, type StyleState } from '../components/bgremover/RemoverControls';
import { useToast } from '../components/common/Toast';
import { useDebounce } from '../hooks/useDebounce';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { loadIcon } from '../services/iconifyService';
import {
  ImageLoadError,
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
import { canvasToBlob, composeImage, contentBounds, type ComposeOptions } from '../utils/imageCompose';
import { buildCustomSvg } from '../utils/svgUtils';
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
  // Letter counters are usually well under 1% of the image; larger enclosed
  // areas (e.g. white lettering inside a shape) are kept by default.
  holeSize: 1,
};
const DEFAULT_STYLE: StyleState = {
  background: '#ffffff',
  transparent: true,
  tintEnabled: false,
  tint: '#000000',
  padding: 0,
  radius: 0,
  trim: false,
  square: false,
  size: null,
};
const SAMPLE_ICON = 'fluent-emoji-flat:rocket';
const MIME: Record<RasterFormat, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

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
  const [settings, setSettings] = useState<RemovalSettings>(DEFAULT_SETTINGS);
  const [ops, setOps] = useState<RemovalOp[]>([]);
  const [redo, setRedo] = useState<RemovalOp[]>([]);
  const [style, setStyle] = useState<StyleState>(DEFAULT_STYLE);
  const [tool, setTool] = useState<PickTool>('remove');
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
      setOps([]);
      setRedo([]);
      setView('result');
      const detected = estimateBackground(image);
      setSettings({ ...DEFAULT_SETTINGS, auto: !!detected });
    } catch (e) {
      setError(e instanceof ImageLoadError ? e.message : 'We couldn’t open that image. Please try another file.');
    } finally {
      setLoading(false);
    }
  }, []);

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
    return { cutout: renderCutout(loaded.image, mask, debouncedSettings), holes: mask.holes };
  }, [loaded, debouncedSettings, ops, detected]);
  const cutout = processed?.cutout ?? null;

  const bounds = useMemo(() => (cutout ? contentBounds(cutout) : null), [cutout]);
  const removedPercent = useMemo(() => (cutout ? countRemoved(cutout) : 0), [cutout]);

  const composeOptions = useMemo<ComposeOptions>(
    () => ({
      background: style.transparent ? null : style.background,
      tint: style.tintEnabled ? style.tint : null,
      padding: style.padding,
      radius: style.radius,
      trim: style.trim,
      square: style.square,
      size: style.size,
    }),
    [style],
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
    setOps((list) => [...list, op]);
    setRedo([]);
    setView('result');
  };

  const onPick = (x: number, y: number) =>
    pushOp(
      tool === 'remove'
        ? { kind: 'remove', x, y, tolerance: settings.tolerance, contiguous: settings.contiguous }
        : { kind: 'restore', x, y, tolerance: settings.tolerance },
    );

  const render = (format: RasterFormat) => {
    if (!cutout || !bounds) throw new Error('no image');
    const opts = { ...composeOptions };
    // JPEG has no alpha channel.
    if (format === 'jpeg' && !opts.background) opts.background = '#ffffff';
    return composeImage(cutout, bounds, opts).canvas;
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
    setOps([]);
    setRedo([]);
    setStyle(DEFAULT_STYLE);
    setSettings(DEFAULT_SETTINGS);
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
            onPick={onPick}
            processing={processing}
          />
          <RemoverControls
            settings={settings}
            onSettings={(patch) => setSettings((s) => ({ ...s, ...patch }))}
            detectedColor={detected ? rgbToHex(detected) : null}
            removedPercent={removedPercent}
            holes={processed?.holes ?? { removed: 0, kept: 0 }}
            style={style}
            onStyle={(patch) => setStyle((s) => ({ ...s, ...patch }))}
            canUndo={ops.length > 0}
            canRedo={redo.length > 0}
            editCount={ops.length}
            onUndo={() => {
              setRedo((r) => [ops[ops.length - 1], ...r]);
              setOps((o) => o.slice(0, -1));
            }}
            onRedo={() => {
              setOps((o) => [...o, redo[0]]);
              setRedo((r) => r.slice(1));
            }}
            onResetEdits={() => {
              setOps([]);
              setRedo([]);
            }}
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
