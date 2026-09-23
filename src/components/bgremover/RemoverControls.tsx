import type { ReactNode } from 'react';
import { Copy, Download, ImagePlus, Loader2, Redo2, RotateCcw, Undo2 } from 'lucide-react';
import { ColorPicker } from '../editor/ColorPicker';
import { RangeField } from '../editor/RangeField';
import { BackgroundControl } from '../editor/BackgroundControl';
import { Switch } from '../common/Switch';
import type { RemovalSettings } from '../../utils/backgroundRemoval';

export type RasterFormat = 'png' | 'jpeg' | 'webp';

export interface StyleState {
  background: string;
  transparent: boolean;
  tintEnabled: boolean;
  tint: string;
  padding: number;
  radius: number;
  trim: boolean;
  square: boolean;
  size: number | null;
}

interface RemoverControlsProps {
  settings: RemovalSettings;
  onSettings: (patch: Partial<RemovalSettings>) => void;
  detectedColor: string | null;
  removedPercent: number;
  holes: { removed: number; kept: number };
  style: StyleState;
  onStyle: (patch: Partial<StyleState>) => void;
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
  return (
    <aside
      id="customize"
      aria-label="Background removal controls"
      className="rounded-2xl border border-border bg-surface lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <h2 className="text-base font-semibold">Controls</h2>
        <button
          type="button"
          onClick={p.onNewImage}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-text"
        >
          <ImagePlus size={13} aria-hidden="true" /> New image
        </button>
      </div>

      <Section
        title="Remove background"
        action={
          <div className="flex gap-1">
            <button type="button" className={iconBtn} onClick={p.onUndo} disabled={!p.canUndo} aria-label="Undo" title="Undo">
              <Undo2 size={15} />
            </button>
            <button type="button" className={iconBtn} onClick={p.onRedo} disabled={!p.canRedo} aria-label="Redo" title="Redo">
              <Redo2 size={15} />
            </button>
          </div>
        }
      >
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

      <Section title="Image color">
        <Switch
          label="Recolor image"
          description="Paints every visible pixel one color. Best for logos, icons and signatures."
          checked={style.tintEnabled}
          onChange={(tintEnabled) => p.onStyle({ tintEnabled })}
        />
        <ColorPicker label="Image color" value={style.tint} disabled={!style.tintEnabled} onChange={(tint) => p.onStyle({ tint, tintEnabled: true })} />
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
