import { useEffect, useId, useState } from 'react';
import { isValidHex, normalizeColor, toHex6 } from '../../utils/svgUtils';

interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  swatches?: string[];
  disabled?: boolean;
  compact?: boolean;
  /** If provided, a checkerboard "transparent" swatch is prepended and calls this when clicked. */
  onTransparent?: () => void;
  /** Whether the transparent swatch should appear selected/active. */
  transparentActive?: boolean;
}

export const DEFAULT_SWATCHES = ['#000000', '#ffffff', '#5b4cf0', '#1ea7f0', '#12b886', '#f59f00', '#f03e3e', '#e64980', '#495057'];

/** Native color picker + editable HEX field + quick swatches. */
export function ColorPicker({ label, value, onChange, swatches = DEFAULT_SWATCHES, disabled, compact, onTransparent, transparentActive }: ColorPickerProps) {
  const id = useId();
  const [text, setText] = useState(value.toUpperCase());
  const invalid = !isValidHex(text);

  useEffect(() => {
    setText(value.toUpperCase());
  }, [value]);

  const commit = (raw: string) => {
    let next = raw.trim();
    if (!next.startsWith('#')) next = `#${next}`;
    setText(next.toUpperCase());
    if (isValidHex(next)) onChange(normalizeColor(next));
  };

  const showSwatches = swatches.length > 0 || Boolean(onTransparent);

  return (
    <div className={disabled ? 'pointer-events-none opacity-50' : ''}>
      {!compact && (
        <label htmlFor={`${id}-hex`} className="mb-2 block text-sm font-medium">
          {label}
        </label>
      )}
      <div className="flex items-center gap-2">
        <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-border shadow-soft">
          <span className="checkerboard absolute inset-0" aria-hidden="true" />
          <span className="absolute inset-0" style={{ backgroundColor: value }} aria-hidden="true" />
          <input
            type="color"
            value={toHex6(value)}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            aria-label={`${label} picker`}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </span>
        <input
          id={`${id}-hex`}
          type="text"
          inputMode="text"
          value={text}
          maxLength={7}
          spellCheck={false}
          disabled={disabled}
          aria-label={compact ? `${label} HEX value` : undefined}
          aria-invalid={invalid}
          onChange={(e) => {
            const next = e.target.value;
            setText(next.toUpperCase());
            if (isValidHex(next.startsWith('#') ? next : `#${next}`)) commit(next);
          }}
          onBlur={() => (invalid ? setText(value.toUpperCase()) : commit(text))}
          className={`h-10 w-full min-w-0 rounded-lg border bg-surface px-3 font-mono text-sm uppercase outline-none focus:ring-2 focus:ring-[var(--ring)] ${
            invalid ? 'border-danger' : 'border-border focus:border-primary'
          }`}
        />
      </div>
      {invalid && <p className="mt-1 text-xs text-danger">Enter a HEX color like #1A2B3C</p>}
      {showSwatches && (
        <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label={`${label} presets`}>
          {/* Transparent / checkerboard swatch */}
          {onTransparent && (
            <button
              type="button"
              onClick={onTransparent}
              aria-label="Transparent"
              aria-pressed={transparentActive}
              title="Transparent"
              className={`relative h-6 w-6 overflow-hidden rounded-full border border-border transition-transform hover:scale-110 ${
                transparentActive ? 'ring-2 ring-primary ring-offset-2 ring-offset-surface' : ''
              }`}
            >
              {/* Mini checkerboard pattern drawn with two pseudo-CSS triangles via a linear gradient */}
              <span
                className="absolute inset-0"
                aria-hidden="true"
                style={{
                  backgroundImage:
                    'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
                  backgroundSize: '6px 6px',
                  backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
                  backgroundColor: '#fff',
                }}
              />
              {/* Diagonal strike-through to signal "none / remove" */}
              <span
                className="absolute inset-0 flex items-center justify-center"
                aria-hidden="true"
                style={{
                  background:
                    'linear-gradient(to top right, transparent calc(50% - 0.5px), #e03131 calc(50% - 0.5px), #e03131 calc(50% + 0.5px), transparent calc(50% + 0.5px))',
                }}
              />
            </button>
          )}

          {swatches.map((swatch) => {
            const selected = !transparentActive && normalizeColor(swatch) === normalizeColor(value);
            return (
              <button
                key={swatch}
                type="button"
                onClick={() => onChange(swatch)}
                aria-label={`Use ${swatch}`}
                aria-pressed={selected}
                className={`h-6 w-6 rounded-full border border-border transition-transform hover:scale-110 ${
                  selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-surface' : ''
                }`}
                style={{ backgroundColor: swatch }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
