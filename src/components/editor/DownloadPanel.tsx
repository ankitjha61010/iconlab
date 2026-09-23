import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useToast } from '../common/Toast';
import { svgToRaster } from '../../utils/imageExport';
import { downloadBlob, downloadText, exportFilename } from '../../utils/downloadUtils';
import type { ExportFormat } from '../../types/icon';

interface DownloadPanelProps {
  iconName: string;
  size: number;
  /** Returns the final standalone SVG markup. */
  getSvg: () => string;
  transparent: boolean;
  background: string;
}

const FORMATS: Array<{ value: ExportFormat; label: string; hint: string }> = [
  { value: 'svg', label: 'SVG', hint: 'Vector' },
  { value: 'png', label: 'PNG', hint: 'Transparent' },
  { value: 'jpeg', label: 'JPG', hint: 'Solid bg' },
];

/** Exports happen entirely in the browser. */
export async function exportIcon(format: ExportFormat, opts: DownloadPanelProps) {
  const svg = opts.getSvg();
  if (format === 'svg') {
    downloadText(svg, exportFilename(opts.iconName, opts.size, 'svg'), 'image/svg+xml');
    return;
  }
  const blob = await svgToRaster(svg, {
    size: opts.size,
    format,
    // JPEG has no alpha channel: fall back to white when the background is transparent.
    background: opts.transparent ? '#ffffff' : opts.background,
  });
  downloadBlob(blob, exportFilename(opts.iconName, opts.size, format === 'jpeg' ? 'jpg' : 'png'));
}

export function DownloadPanel(props: DownloadPanelProps) {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const notify = useToast();

  const run = async (format: ExportFormat) => {
    setBusy(format);
    try {
      await exportIcon(format, props);
      notify(`${format === 'jpeg' ? 'JPG' : format.toUpperCase()} downloaded`);
    } catch {
      notify('Export failed. Please try again.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-medium">Download</span>
        <span className="text-xs tabular-nums text-muted">
          {props.size} × {props.size}px
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {FORMATS.map((format) => (
          <button
            key={format.value}
            type="button"
            onClick={() => run(format.value)}
            disabled={busy !== null}
            aria-label={`Download ${format.label}`}
            className={`group flex flex-col items-center justify-center gap-0.5 rounded-xl py-2.5 text-sm font-semibold transition-colors disabled:opacity-60 ${
              format.value === 'svg'
                ? 'bg-primary text-primary-contrast hover:bg-primary-hover'
                : 'border border-border bg-surface text-text hover:border-border-strong hover:bg-surface-2'
            }`}
          >
            <span className="flex items-center gap-1.5">
              {busy === format.value ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
              {format.label}
            </span>
            <span className={`text-[11px] font-normal ${format.value === 'svg' ? 'opacity-80' : 'text-muted'}`}>{format.hint}</span>
          </button>
        ))}
      </div>
      {props.transparent && <p className="mt-2 text-xs text-muted">JPG doesn’t support transparency, so it’s exported on white.</p>}
    </div>
  );
}
