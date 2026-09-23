import type { ReactNode } from 'react';
import { Bold, Copy, Download, FlipHorizontal2, FlipVertical2, ImagePlus, Italic, Loader2, Redo2, RotateCcw, RotateCw, Trash2, Type, Undo2 } from 'lucide-react';
import { ColorPicker } from '../editor/ColorPicker';
import { RangeField } from '../editor/RangeField';
import { BackgroundControl } from '../editor/BackgroundControl';
import { Switch } from '../common/Switch';
import type { RemovalSettings } from '../../utils/backgroundRemoval';
import { IDENTITY_TRANSFORM, type ImageTransform, type TextItem } from '../../utils/imageCompose';

export type RasterFormat = 'png' | 'jpeg' | 'webp';

export interface StyleState {
  background: string;
  transparent: boolean;
  tintEnabled: boolean;
  tint: string;
  /** Image color is "transparent": the subject is cut out of the background. */
  tintTransparent: boolean;
  /** Line color and width (0–20) of the shape outline drawn when the image color is transparent. */
  outlineColor: string;
  outlineWidth: number;
  padding: number;
  radius: number;
  trim: boolean;
  square: boolean;
  size: number | null;
  /** Move / resize / rotate / flip of the subject on the canvas. */
  transform: ImageTransform;
  /** Per-element edits (text lines, shapes), each tied to a pixel inside the element. */
  elements: ElementEdit[];
  /** How close parts must be to count as one element, in % of the image size. */
  elementGap: number;
  /** Pixels inside elements that were split into separate letters / shapes. */
  splits: number[];
  /** Text added on top of the image. */
  texts: TextItem[];
}

/** Fonts available for added text: system stacks, so they render the same in the preview and the export. */
export const TEXT_FONTS = [
  { label: 'Sans', value: 'Inter, "Helvetica Neue", Arial, sans-serif' },
  { label: 'Rounded', value: '"Trebuchet MS", "Segoe UI", Verdana, sans-serif' },
  { label: 'Heavy', value: 'Impact, "Arial Black", Haettenschweiler, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: '"Courier New", Courier, monospace' },
  { label: 'Script', value: '"Brush Script MT", "Segoe Script", "Comic Sans MS", cursive' },
] as const;

export interface ElementEdit {
  anchor: number;
  /** x / y in source px. */
  transform: ImageTransform;
}

interface RemoverControlsProps {
  settings: RemovalSettings;
  onSettings: (patch: Partial<RemovalSettings>) => void;
  detectedColor: string | null;
  removedPercent: number;
  holes: { removed: number; kept: number };
  style: StyleState;
  onStyle: (patch: Partial<StyleState>) => void;
  onTransform: (patch: Partial<ImageTransform>) => void;
  selectedLayer: number | null;
  selectedLayerTransform: ImageTransform | null;
  onSelectedLayerTransform: (patch: Partial<ImageTransform>) => void;
  onDeselect: () => void;
  onStartEditing: () => void;
  selectedText: TextItem | null;
  onTextChange: (patch: Partial<TextItem>) => void;
  onAddText: () => void;
  onDeleteText: () => void;
  /** Elements the user deleted from the image. */
  deletedCount: number;
  canUndo: boolean;
  canRedo: boolean;
  editCount: number;
  onUndo: () => void;
  onRedo: () => void;
  onResetEdits: () => void;
  outputSize: { width: number; height: number };
  onDownload: (format: RasterFormat) => void;
  onCopy: () => void;
  onNewImage: () => void;
  busy: RasterFormat | 'copy' | null;
}

const SIZES: Array<{ label: string; value: number | null }> = [
  { label: 'Original', value: null },
  { label: '512', value: 512 },
  { label: '1024', value: 1024 },
  { label: '2048', value: 2048 },
];

const normalizeAngle = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-b border-border px-5 py-5 last:border-0">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
        {action}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

const iconBtn =
  'inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40 disabled:pointer-events-none';

export function RemoverControls(p: RemoverControlsProps) {
  const { settings, style } = p;
  const t = style.transform;
  const transformed =
    t.rotate !== 0 || t.zoom !== 1 || t.x !== 0 || t.y !== 0 || t.flipX || t.flipY;
  /** Keeps the angle in −180…180. */
  const rotateBy = (deg: number) => p.onTransform({ rotate: normalizeAngle(t.rotate + deg) });
  const lt = p.selectedLayerTransform;
  return (
    <aside
      id="customize"
      aria-label="Background removal controls"
      className="rounded-2xl border border-border bg-surface lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <h2 className="text-base font-semibold">Controls</h2>
        <div className="flex items-center gap-1">
          <button type="button" className={iconBtn} onClick={p.onUndo} disabled={!p.canUndo} aria-label="Undo" title="Undo (Ctrl/⌘+Z)">
            <Undo2 size={15} />
          </button>
          <button type="button" className={iconBtn} onClick={p.onRedo} disabled={!p.canRedo} aria-label="Redo" title="Redo (Ctrl/⌘+Shift+Z)">
            <Redo2 size={15} />
          </button>
          <button
          type="button"
          onClick={p.onNewImage}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-text"
        >
          <ImagePlus size={13} aria-hidden="true" /> New image
          </button>
        </div>
      </div>

      <Section title="Remove background">
        <Switch
          label="Auto remove"
          description={
            p.detectedColor ? (
              <span className="inline-flex items-center gap-1.5">
                Detected background
                <span className="inline-block h-3 w-3 rounded-sm border border-border" style={{ backgroundColor: p.detectedColor }} aria-hidden="true" />
                <span className="font-mono uppercase">{p.detectedColor}</span>
              </span>
            ) : (
              'The border of this image is already transparent.'
            )
          }
          checked={settings.auto}
          disabled={!p.detectedColor}
          onChange={(auto) => p.onSettings({ auto })}
        />
        <RangeField label="Tolerance" value={settings.tolerance} min={0} max={100} unit="%" onChange={(tolerance) => p.onSettings({ tolerance })} />
        <Switch
          label="Only areas touching the edge"
          description="Turn off to also remove matching colors inside the subject (e.g. holes in letters)."
          checked={settings.contiguous}
          onChange={(contiguous) => p.onSettings({ contiguous })}
        />
        <div className={settings.auto && settings.contiguous ? '' : 'pointer-events-none opacity-50'}>
          <Switch
            label="Remove holes inside letters"
            description="Clears enclosed background-colored areas, like the inside of “o”, “e” or “d”."
            checked={settings.removeHoles}
            onChange={(removeHoles) => p.onSettings({ removeHoles })}
          />
          {settings.removeHoles && (
            <div className="mt-4">
              <RangeField
                label="Max hole size"
                value={settings.holeSize}
                min={0.1}
                max={10}
                step={0.1}
                unit="%"
                onChange={(holeSize) => p.onSettings({ holeSize })}
              />
              {(p.holes.removed > 0 || p.holes.kept > 0) && (
                <p className="mt-2 text-xs text-muted">
                  Removed {p.holes.removed} enclosed area{p.holes.removed === 1 ? '' : 's'}
                  {p.holes.kept > 0 &&
                    ` · kept ${p.holes.kept} larger one${p.holes.kept === 1 ? '' : 's'} (raise the size, or use Erase area, to remove ${p.holes.kept === 1 ? 'it' : 'them'})`}
                </p>
              )}
            </div>
          )}
        </div>
        <RangeField label="Edge smoothing" value={settings.smoothing} min={0} max={100} unit="%" onChange={(smoothing) => p.onSettings({ smoothing })} />
        <Switch
          label="Clean color fringe"
          description="Removes the old background tint from anti-aliased edges."
          checked={settings.cleanHalo}
          onChange={(cleanHalo) => p.onSettings({ cleanHalo })}
        />
        <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
          <span>
            {Math.round(p.removedPercent * 100)}% removed · {p.editCount} manual edit{p.editCount === 1 ? '' : 's'}
          </span>
          {p.editCount > 0 && (
            <button type="button" onClick={p.onResetEdits} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              <RotateCcw size={12} aria-hidden="true" /> Clear edits
            </button>
          )}
        </div>
      </Section>

      {p.selectedLayer !== null && lt && (
        <Section
          title="Selected element"
          action={
            <button type="button" onClick={p.onDeselect} className="text-xs font-medium text-muted hover:text-text">
              Done
            </button>
          }
        >
          <RangeField label="Size" value={Math.round(lt.zoom * 100)} min={10} max={400} unit="%" onChange={(v) => p.onSelectedLayerTransform({ zoom: v / 100 })} />
          <RangeField label="Rotate" value={Math.round(lt.rotate)} min={-180} max={180} unit="°" onChange={(rotate) => p.onSelectedLayerTransform({ rotate })} />
          <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Rotate and flip element">
            {(
              [
                ['Rotate left 90°', <RotateCcw size={15} />, () => p.onSelectedLayerTransform({ rotate: normalizeAngle(lt.rotate - 90) }), false],
                ['Rotate right 90°', <RotateCw size={15} />, () => p.onSelectedLayerTransform({ rotate: normalizeAngle(lt.rotate + 90) }), false],
                ['Flip horizontal', <FlipHorizontal2 size={15} />, () => p.onSelectedLayerTransform({ flipX: !lt.flipX }), lt.flipX],
                ['Flip vertical', <FlipVertical2 size={15} />, () => p.onSelectedLayerTransform({ flipY: !lt.flipY }), lt.flipY],
              ] as const
            ).map(([label, icon, onClick, active]) => (
              <button
                key={label}
                type="button"
                onClick={onClick}
                aria-label={label}
                aria-pressed={active}
                title={label}
                className={`inline-flex h-9 items-center justify-center rounded-md border transition-colors ${
                  active ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted hover:bg-surface-2 hover:text-text'
                }`}
              >
                {icon}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => p.onSelectedLayerTransform(IDENTITY_TRANSFORM)}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <RotateCcw size={12} aria-hidden="true" /> Put this element back
          </button>
          <button
            type="button"
            onClick={() => p.onSelectedLayerTransform({ hidden: true })}
            className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-border text-sm font-medium text-danger hover:bg-surface-2"
          >
            <Trash2 size={15} aria-hidden="true" /> Delete element
          </button>
          <p className="text-xs text-muted">Drag it in the preview to move it; use the align buttons above the preview to line it up.</p>
        </Section>
      )}

      {p.selectedText && (
        <Section
          title="Selected text"
          action={
            <button type="button" onClick={p.onDeselect} className="text-xs font-medium text-muted hover:text-text">
              Done
            </button>
          }
        >
          <div>
            <label htmlFor="text-content" className="mb-2 block text-sm font-medium">
              Text
            </label>
            <textarea
              id="text-content"
              rows={2}
              value={p.selectedText.text}
              onChange={(e) => p.onTextChange({ text: e.target.value })}
              className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-[var(--ring)]"
            />
          </div>
          <div>
            <span className="mb-2 block text-sm font-medium">Font</span>
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Font">
              {TEXT_FONTS.map((f) => (
                <button
                  key={f.label}
                  type="button"
                  aria-pressed={p.selectedText!.font === f.value}
                  onClick={() => p.onTextChange({ font: f.value })}
                  style={{ fontFamily: f.value }}
                  className={`rounded-md border px-2 py-1.5 text-sm transition-colors ${
                    p.selectedText!.font === f.value ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted hover:text-text'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-1.5">
            {(
              [
                ['Bold', <Bold size={15} />, 'bold'],
                ['Italic', <Italic size={15} />, 'italic'],
              ] as const
            ).map(([label, icon, key]) => (
              <button
                key={key}
                type="button"
                aria-label={label}
                aria-pressed={p.selectedText![key]}
                title={label}
                onClick={() => p.onTextChange({ [key]: !p.selectedText![key] })}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${
                  p.selectedText![key] ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted hover:bg-surface-2 hover:text-text'
                }`}
              >
                {icon}
              </button>
            ))}
          </div>
          <RangeField
            label="Size"
            value={Math.round(p.selectedText.size * 100)}
            min={1}
            max={80}
            unit="%"
            onChange={(v) => p.onTextChange({ size: v / 100 })}
          />
          <RangeField label="Rotate" value={Math.round(p.selectedText.rotate)} min={-180} max={180} unit="°" onChange={(rotate) => p.onTextChange({ rotate })} />
          <ColorPicker label="Text color" value={p.selectedText.color} onChange={(color) => p.onTextChange({ color })} />
          <button
            type="button"
            onClick={p.onDeleteText}
            className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-border text-sm font-medium text-danger hover:bg-surface-2"
          >
            <Trash2 size={15} aria-hidden="true" /> Delete text
          </button>
        </Section>
      )}

      <Section
        title="Position & size"
        action={
          transformed && (
            <button
              type="button"
              onClick={() => p.onTransform(IDENTITY_TRANSFORM)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <RotateCcw size={12} aria-hidden="true" /> Reset
            </button>
          )
        }
      >
        <p className="-mt-2 text-xs text-muted">
          These change the whole image. To move one text or shape on its own,{' '}
          <button type="button" onClick={p.onStartEditing} className="font-medium text-primary hover:underline">
            pick Edit image
          </button>{' '}
          and click it in the preview.
        </p>
        <RangeField label="Size" value={Math.round(t.zoom * 100)} min={10} max={400} unit="%" onChange={(v) => p.onTransform({ zoom: v / 100 })} />
        <RangeField label="Rotate" value={Math.round(t.rotate)} min={-180} max={180} unit="°" onChange={(rotate) => p.onTransform({ rotate })} />
        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Rotate and flip">
          {(
            [
              ['Rotate left 90°', <RotateCcw size={15} />, () => rotateBy(-90), false],
              ['Rotate right 90°', <RotateCw size={15} />, () => rotateBy(90), false],
              ['Flip horizontal', <FlipHorizontal2 size={15} />, () => p.onTransform({ flipX: !t.flipX }), t.flipX],
              ['Flip vertical', <FlipVertical2 size={15} />, () => p.onTransform({ flipY: !t.flipY }), t.flipY],
            ] as const
          ).map(([label, icon, onClick, active]) => (
            <button
              key={label}
              type="button"
              onClick={onClick}
              aria-label={label}
              aria-pressed={active}
              title={label}
              className={`inline-flex h-9 items-center justify-center rounded-md border transition-colors ${
                active ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted hover:bg-surface-2 hover:text-text'
              }`}
            >
              {icon}
            </button>
          ))}
        </div>
        <RangeField label="Move left / right" value={Math.round(t.x * 100)} min={-100} max={100} unit="%" onChange={(v) => p.onTransform({ x: v / 100 })} />
        <RangeField label="Move up / down" value={Math.round(t.y * 100)} min={-100} max={100} unit="%" onChange={(v) => p.onTransform({ y: v / 100 })} />
        <div className="rounded-lg bg-surface-2 px-3 py-3">
          <RangeField
            label="Element detection"
            value={style.elementGap}
            min={0}
            max={10}
            step={0.5}
            unit="%"
            onChange={(elementGap) => p.onStyle({ elementGap })}
          />
          <p className="mt-2 text-xs text-muted">
            Parts closer than this are one element. Lower it to split words apart, raise it to keep a logo together. To move single
            letters, double-click an element in the preview.
          </p>
          {p.deletedCount > 0 && (
            <p className="mt-2 text-xs text-muted">
              {p.deletedCount} deleted element{p.deletedCount === 1 ? '' : 's'}. Undo, or put all elements back to restore.
            </p>
          )}
          {(style.elements.length > 0 || style.splits.length > 0) && (
            <button
              type="button"
              onClick={() => p.onStyle({ elements: [], splits: [] })}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <RotateCcw size={12} aria-hidden="true" /> Put all elements back
            </button>
          )}
        </div>
      </Section>

      <Section title="Text">
        <p className="-mt-2 text-xs text-muted">
          Add your own text on top of the image. To swap existing text, select it with <strong className="text-text">Edit image</strong> and
          choose <strong className="text-text">Replace with text</strong>.
        </p>
        <button
          type="button"
          onClick={p.onAddText}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium hover:bg-surface-2"
        >
          <Type size={15} aria-hidden="true" /> Add text
        </button>
      </Section>

      <Section title="Image color">
        <Switch
          label="Recolor image"
          description={
            style.tintEnabled && style.tintTransparent
              ? 'Removes the image colors and keeps only its shape as an outline. With a background, the shape is also cut out of it.'
              : 'Paints every visible pixel one color. Best for logos, icons and signatures.'
          }
          checked={style.tintEnabled}
          onChange={(tintEnabled) => p.onStyle({ tintEnabled })}
        />
        <ColorPicker
          label="Image color"
          value={style.tint}
          disabled={!style.tintEnabled}
          onChange={(tint) => p.onStyle({ tint, tintEnabled: true, tintTransparent: false })}
          onTransparent={() => p.onStyle({ tintEnabled: true, tintTransparent: true })}
          transparentActive={style.tintTransparent}
        />
        {style.tintEnabled && style.tintTransparent && (
          <>
            <ColorPicker label="Outline color" value={style.outlineColor} onChange={(outlineColor) => p.onStyle({ outlineColor })} />
            <RangeField
              label="Outline width"
              value={style.outlineWidth}
              min={style.transparent ? 1 : 0}
              max={20}
              onChange={(outlineWidth) => p.onStyle({ outlineWidth })}
            />
          </>
        )}
      </Section>

      <Section title="Background">
        <BackgroundControl
          background={style.background}
          transparent={style.transparent}
          padding={style.padding}
          radius={style.radius}
          onChange={(patch) => p.onStyle(patch)}
        />
        <Switch label="Trim empty space" description="Crop to the visible subject." checked={style.trim} onChange={(trim) => p.onStyle({ trim })} />
        <Switch label="Square canvas" checked={style.square} onChange={(square) => p.onStyle({ square })} />
      </Section>

      <Section title="Export">
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-medium">Size</span>
            <span className="text-xs tabular-nums text-muted">
              {p.outputSize.width} × {p.outputSize.height}px
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Output size">
            {SIZES.map((s) => (
              <button
                key={s.label}
                type="button"
                aria-pressed={style.size === s.value}
                onClick={() => p.onStyle({ size: s.value })}
                className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                  style.size === s.value ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted hover:text-text'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['png', 'PNG', 'Transparent'],
              ['jpeg', 'JPG', 'Solid bg'],
              ['webp', 'WebP', 'Small file'],
            ] as const
          ).map(([format, label, hint]) => (
            <button
              key={format}
              type="button"
              onClick={() => p.onDownload(format)}
              disabled={p.busy !== null}
              aria-label={`Download ${label}`}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-xl py-2.5 text-sm font-semibold transition-colors disabled:opacity-60 ${
                format === 'png'
                  ? 'bg-primary text-primary-contrast hover:bg-primary-hover'
                  : 'border border-border bg-surface text-text hover:border-border-strong hover:bg-surface-2'
              }`}
            >
              <span className="flex items-center gap-1.5">
                {p.busy === format ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
                {label}
              </span>
              <span className={`text-[11px] font-normal ${format === 'png' ? 'opacity-80' : 'text-muted'}`}>{hint}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={p.onCopy}
          disabled={p.busy !== null}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium hover:bg-surface-2 disabled:opacity-60"
        >
          {p.busy === 'copy' ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          Copy image to clipboard
        </button>
        {style.transparent && <p className="text-xs text-muted">JPG doesn’t support transparency, so it’s exported on white.</p>}
      </Section>
    </aside>
  );
}
