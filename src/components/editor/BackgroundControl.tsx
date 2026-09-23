import { ColorPicker } from './ColorPicker';
import { RangeField } from './RangeField';

interface BackgroundControlProps {
  background: string;
  transparent: boolean;
  padding: number;
  radius: number;
  onChange: (patch: { background?: string; transparent?: boolean; padding?: number; radius?: number }) => void;
}

const BG_SWATCHES = ['#ffffff', '#f1f3f5', '#14152b', '#eeecff', '#e7f5ff', '#ebfbee', '#fff9db', '#fff0f6'];

export function BackgroundControl({ background, transparent, padding, radius, onChange }: BackgroundControlProps) {
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium" id="bg-label">
            Background
          </span>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
            Transparent
            <button
              type="button"
              role="switch"
              aria-checked={transparent}
              aria-label="Transparent background"
              onClick={() => onChange({ transparent: !transparent })}
              className={`relative h-5 w-9 rounded-full transition-colors ${transparent ? 'bg-primary' : 'bg-border-strong'}`}
            >
              <span
                className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${transparent ? 'translate-x-4' : 'translate-x-0.5'}`}
              />
            </button>
          </label>
        </div>
        <ColorPicker
          compact
          label="Background color"
          value={background}
          swatches={BG_SWATCHES}
          onChange={(hex) => onChange({ background: hex, transparent: false })}
        />
      </div>
      <RangeField label="Padding" value={padding} min={0} max={40} unit="%" onChange={(v) => onChange({ padding: v })} />
      <div className={transparent ? 'opacity-50' : ''}>
        <RangeField label="Corner radius" value={radius} min={0} max={50} unit="%" onChange={(v) => onChange({ radius: v, transparent: false })} />
        <div className="mt-2.5 flex gap-1.5" role="group" aria-label="Shape presets">
          {[
            { label: 'Square', value: 0 },
            { label: 'Rounded', value: 20 },
            { label: 'Circle', value: 50 },
          ].map((shape) => (
            <button
              key={shape.label}
              type="button"
              aria-pressed={!transparent && radius === shape.value}
              onClick={() => onChange({ radius: shape.value, transparent: false })}
              className={`flex-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                !transparent && radius === shape.value ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted hover:text-text'
              }`}
            >
              {shape.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
