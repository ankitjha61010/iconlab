import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw } from 'lucide-react';
import { RangeField } from './RangeField';

interface RotationControlProps {
  rotate: number;
  hFlip: boolean;
  vFlip: boolean;
  onRotate: (deg: number) => void;
  onFlip: (axis: 'h' | 'v') => void;
}

const normalize = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;

export function RotationControl({ rotate, hFlip, vFlip, onRotate, onFlip }: RotationControlProps) {
  const toggle = (active: boolean) =>
    `inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors ${
      active ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-text hover:bg-surface-2'
    }`;

  return (
    <div className="space-y-5">
      <div>
        <RangeField label="Rotation" value={rotate} min={0} max={359} unit="°" onChange={onRotate} />
        <div className="mt-2.5 flex gap-1.5">
          <button type="button" className={toggle(false)} onClick={() => onRotate(normalize(rotate - 90))} aria-label="Rotate 90 degrees counter-clockwise">
            <RotateCcw size={15} aria-hidden="true" /> 90°
          </button>
          <button type="button" className={toggle(false)} onClick={() => onRotate(normalize(rotate + 90))} aria-label="Rotate 90 degrees clockwise">
            <RotateCw size={15} aria-hidden="true" /> 90°
          </button>
        </div>
      </div>
      <div>
        <span className="mb-2 block text-sm font-medium" id="flip-label">
          Flip
        </span>
        <div className="flex gap-1.5" role="group" aria-labelledby="flip-label">
          <button type="button" className={toggle(hFlip)} aria-pressed={hFlip} onClick={() => onFlip('h')}>
            <FlipHorizontal2 size={15} aria-hidden="true" /> Horizontal
          </button>
          <button type="button" className={toggle(vFlip)} aria-pressed={vFlip} onClick={() => onFlip('v')}>
            <FlipVertical2 size={15} aria-hidden="true" /> Vertical
          </button>
        </div>
      </div>
    </div>
  );
}
