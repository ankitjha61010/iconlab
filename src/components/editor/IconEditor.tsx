import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Grid3x3, Info, Moon, RotateCcw, Square, Sun } from 'lucide-react';
import { ColorPicker } from './ColorPicker';
import { BackgroundControl } from './BackgroundControl';
import { SizeControl } from './SizeControl';
import { RotationControl } from './RotationControl';
import { DownloadPanel } from './DownloadPanel';
import { CodePanel } from './CodePanel';
import { analyzeColors, buildCustomSvg } from '../../utils/svgUtils';
import type { IconCustomization, IconData } from '../../types/icon';

export const DEFAULT_CUSTOMIZATION: IconCustomization = {
  color: '#000000',
  palette: {},
  background: '#ffffff',
  transparent: true,
  size: 256,
  rotate: 0,
  hFlip: false,
  vFlip: false,
  padding: 0,
  radius: 0,
};

type Stage = 'checker' | 'grid' | 'light' | 'dark';
const STAGES: Array<{ value: Stage; label: string; icon: ReactNode; className: string }> = [
  { value: 'checker', label: 'Transparency grid', icon: <Square size={15} />, className: 'stage-checker' },
  { value: 'grid', label: 'Pixel grid', icon: <Grid3x3 size={15} />, className: 'stage-grid' },
  { value: 'light', label: 'Light background', icon: <Sun size={15} />, className: 'bg-white' },
  { value: 'dark', label: 'Dark background', icon: <Moon size={15} />, className: 'bg-[#14152b]' },
];

const MAX_PREVIEW = 320;

function PanelSection({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-b border-border px-5 py-5 last:border-0">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

interface IconEditorProps {
  icon: IconData;
  iconName: string;
  title: string;
  custom: IconCustomization;
  onChange: (next: IconCustomization) => void;
}

export function IconEditor({ icon, iconName, title, custom, onChange }: IconEditorProps) {
  const [stage, setStage] = useState<Stage>('checker');
  const analysis = useMemo(() => analyzeColors(icon.body), [icon.body]);
  const update = useCallback((patch: Partial<IconCustomization>) => onChange({ ...custom, ...patch }), [custom, onChange]);

  const exportSvg = useMemo(() => buildCustomSvg(icon, custom), [icon, custom]);
  const previewSvg = useMemo(() => buildCustomSvg(icon, custom, { inline: true, displaySize: '100%' }), [icon, custom]);
  const getSvg = useCallback(() => exportSvg, [exportSvg]);

  const displaySize = Math.min(custom.size, MAX_PREVIEW);
  const scaled = custom.size > MAX_PREVIEW;
  const isDirty = JSON.stringify(custom) !== JSON.stringify(DEFAULT_CUSTOMIZATION);
  const paletteEntries = analysis.colors;

  const setPaletteColor = (original: string, next: string) => {
    const palette = { ...custom.palette };
    if (next === original) delete palette[original];
    else palette[original] = next;
    update({ palette });
  };

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      {/* Mobile order: preview → customize → code. Desktop: preview + code left, panel right. */}
      <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-6">
      <section aria-label="Preview" className="order-1 overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="text-sm font-medium">Preview</span>
          <div className="flex gap-1 rounded-lg bg-surface-2 p-1" role="radiogroup" aria-label="Preview background">
            {STAGES.map((s) => (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={stage === s.value}
                aria-label={s.label}
                title={s.label}
                onClick={() => setStage(s.value)}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                  stage === s.value ? 'bg-surface text-text shadow-soft' : 'text-muted hover:text-text'
                }`}
              >
                {s.icon}
              </button>
            ))}
          </div>
        </div>
        <div
          className={`relative flex min-h-[340px] items-center justify-center p-8 sm:min-h-[420px] ${STAGES.find((s) => s.value === stage)!.className}`}
        >
          <div
            role="img"
            aria-label={`${title} icon preview`}
            className="icon-svg transition-[width,height] duration-150"
            style={{ width: displaySize, height: displaySize }}
            dangerouslySetInnerHTML={{ __html: previewSvg }}
          />
          <span className="absolute bottom-3 left-3 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white tabular-nums">
            {custom.size}px{scaled ? ` · shown at ${Math.round((MAX_PREVIEW / custom.size) * 100)}%` : ''}
          </span>
        </div>
        <div className="flex items-end justify-center gap-6 border-t border-border px-4 py-4" aria-label="Actual size previews">
          {[16, 24, 32, 48, 64].map((px) => (
            <div key={px} className="flex flex-col items-center gap-1.5">
              <div className="icon-svg" style={{ width: px, height: px }} dangerouslySetInnerHTML={{ __html: previewSvg }} aria-hidden="true" />
              <span className="text-[11px] tabular-nums text-muted">{px}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="order-3 min-w-0">
        <CodePanel iconName={iconName} custom={custom} svg={exportSvg} colorMode={analysis.mode} />
      </div>
      </div>

      {/* Customization */}
      <aside
        id="customize"
        aria-label="Customize icon"
        className="order-2 rounded-2xl border border-border bg-surface lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-base font-semibold">Customize</h2>
          <button
            type="button"
            onClick={() => onChange(DEFAULT_CUSTOMIZATION)}
            disabled={!isDirty}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"
          >
            <RotateCcw size={12} aria-hidden="true" /> Reset
          </button>
        </div>

        <PanelSection
          title="Color"
          action={
            Object.keys(custom.palette).length > 0 ? (
              <button type="button" onClick={() => update({ palette: {} })} className="text-xs font-medium text-primary hover:underline">
                Restore original colors
              </button>
            ) : undefined
          }
        >
          {analysis.mode !== 'multi' && (
            <ColorPicker label={analysis.mode === 'mixed' ? 'Main color' : 'Icon color'} value={custom.color} onChange={(color) => update({ color })} />
          )}
          {analysis.mode !== 'mono' && (
            <div className={analysis.mode === 'mixed' ? 'mt-5' : ''}>
              <p className="mb-3 flex gap-2 rounded-lg bg-surface-2 p-2.5 text-xs text-muted">
                <Info size={14} className="mt-px shrink-0" aria-hidden="true" />
                {analysis.mode === 'multi'
                  ? 'This is a multicolor icon. Its original colors are preserved — you can swap individual colors below.'
                  : 'This icon also uses fixed colors. They are preserved unless you change them below.'}
              </p>
              <ul className="space-y-3" aria-label="Icon palette">
                {paletteEntries.slice(0, 12).map((original) => (
                  <li key={original}>
                    <ColorPicker
                      compact
                      label={`Palette color ${original}`}
                      value={custom.palette[original] ?? original}
                      swatches={[]}
                      onChange={(next) => setPaletteColor(original, next)}
                    />
                  </li>
                ))}
              </ul>
              {paletteEntries.length > 12 && (
                <p className="mt-2 text-xs text-muted">Showing the first 12 of {paletteEntries.length} colors.</p>
              )}
            </div>
          )}
        </PanelSection>

        <PanelSection title="Background">
          <BackgroundControl
            background={custom.background}
            transparent={custom.transparent}
            padding={custom.padding}
            radius={custom.radius}
            onChange={update}
          />
        </PanelSection>

        <PanelSection title="Size">
          <SizeControl value={custom.size} onChange={(size) => update({ size })} />
        </PanelSection>

        <PanelSection title="Transform">
          <RotationControl
            rotate={custom.rotate}
            hFlip={custom.hFlip}
            vFlip={custom.vFlip}
            onRotate={(rotate) => update({ rotate })}
            onFlip={(axis) => update(axis === 'h' ? { hFlip: !custom.hFlip } : { vFlip: !custom.vFlip })}
          />
        </PanelSection>

        <PanelSection title="Export">
          <DownloadPanel
            iconName={iconName}
            size={custom.size}
            getSvg={getSvg}
            transparent={custom.transparent}
            background={custom.background}
          />
        </PanelSection>
      </aside>
    </div>
  );
}
