import { RangeField } from './RangeField';
import { MAX_RASTER_SIZE } from '../../utils/imageExport';

const PRESETS = [16, 24, 32, 64, 128, 256, 512, 1024];

export function SizeControl({ value, onChange }: { value: number; onChange: (size: number) => void }) {
  return (
    <div>
      <RangeField label="Size" value={value} min={16} max={MAX_RASTER_SIZE} unit="px" onChange={onChange} />
      <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label="Size presets">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            aria-pressed={value === preset}
            className={`rounded-md border px-2 py-1 text-xs font-medium tabular-nums transition-colors ${
              value === preset ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted hover:text-text'
            }`}
          >
            {preset}
          </button>
        ))}
      </div>
    </div>
  );
}
