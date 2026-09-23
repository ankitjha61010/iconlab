import { useEffect, useRef, type MouseEvent } from 'react';
import { Eraser, Grid3x3, Moon, Paintbrush, Square, Sun } from 'lucide-react';
import { composeImage, type Bounds, type ComposeLayout, type ComposeOptions } from '../../utils/imageCompose';

export type PreviewStage = 'checker' | 'grid' | 'light' | 'dark';
export type PickTool = 'remove' | 'restore';
export type PreviewView = 'result' | 'original';

const STAGES = [
  { value: 'checker', label: 'Transparency grid', icon: <Square size={15} />, className: 'stage-checker' },
  { value: 'grid', label: 'Pixel grid', icon: <Grid3x3 size={15} />, className: 'stage-grid' },
  { value: 'light', label: 'Light background', icon: <Sun size={15} />, className: 'bg-white' },
  { value: 'dark', label: 'Dark background', icon: <Moon size={15} />, className: 'bg-[#14152b]' },
] as const;

const PREVIEW_SIZE = 1000;

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
  onPick: (x: number, y: number) => void;
  processing: boolean;
}

export function RemoverPreview(props: RemoverPreviewProps) {
  const { cutout, bounds, options, originalUrl, view, stage, tool, onPick, processing } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<ComposeLayout | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const longest = Math.max(cutout.width, cutout.height);
    const { layout } = composeImage(cutout, bounds, { ...options, size: Math.min(PREVIEW_SIZE, longest) }, canvasRef.current);
    layoutRef.current = layout;
  }, [cutout, bounds, options]);

  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const layout = layoutRef.current;
    const canvas = canvasRef.current;
    if (!layout || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const cy = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const x = (cx - layout.offsetX) / layout.scale;
    const y = (cy - layout.offsetY) / layout.scale;
    if (x >= 0 && y >= 0 && x < cutout.width && y < cutout.height) onPick(x, y);
  };

  const stageClass = STAGES.find((s) => s.value === stage)!.className;
  const toggle = (active: boolean) =>
    `inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors ${
      active ? 'bg-surface text-text shadow-soft' : 'text-muted hover:text-text'
    }`;

  return (
    <section aria-label="Image preview" className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:px-4">
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1" role="radiogroup" aria-label="Compare">
          {(['result', 'original'] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => props.onViewChange(v)} className={toggle(view === v)}>
              {v === 'result' ? 'Result' : 'Original'}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1" role="radiogroup" aria-label="Click tool">
          <button type="button" role="radio" aria-checked={tool === 'remove'} onClick={() => props.onToolChange('remove')} className={toggle(tool === 'remove')} title="Click an area to remove it">
            <Eraser size={14} aria-hidden="true" /> Erase area
          </button>
          <button type="button" role="radio" aria-checked={tool === 'restore'} onClick={() => props.onToolChange('restore')} className={toggle(tool === 'restore')} title="Click an area to bring it back">
            <Paintbrush size={14} aria-hidden="true" /> Restore area
          </button>
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
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                stage === s.value ? 'bg-surface text-text shadow-soft' : 'text-muted hover:text-text'
              }`}
            >
              {s.icon}
            </button>
          ))}
        </div>
      </div>

      <div className={`relative flex min-h-[360px] items-center justify-center p-4 sm:min-h-[480px] sm:p-8 ${stageClass}`}>
        <canvas
          ref={canvasRef}
          onClick={onClick}
          className={`max-h-[70vh] max-w-full cursor-crosshair object-contain ${view === 'original' ? 'hidden' : ''}`}
          role="img"
          aria-label={`Result preview. Click to ${tool === 'remove' ? 'erase' : 'restore'} a region.`}
        />
        {view === 'original' && <img src={originalUrl} alt="Original upload" className="max-h-[70vh] max-w-full object-contain" />}
        {processing && (
          <span className="absolute right-3 top-3 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">Processing…</span>
        )}
      </div>
      <p className="border-t border-border px-4 py-2.5 text-xs text-muted">
        Tip: click any leftover background to <strong className="text-text">erase</strong> it, or switch to <strong className="text-text">Restore</strong> and click
        a part that was removed by mistake.
      </p>
    </section>
  );
}
