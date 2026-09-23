import { useId, type ReactElement, type ReactNode } from 'react';

interface TooltipProps {
  label: ReactNode;
  children: ReactElement;
  side?: 'top' | 'bottom';
}

/** CSS-only tooltip shown on hover and keyboard focus. */
export function Tooltip({ label, children, side = 'top' }: TooltipProps) {
  const id = useId();
  return (
    <span className="group/tooltip relative inline-flex" aria-describedby={id}>
      {children}
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-header px-2 py-1 text-xs font-medium text-header-text opacity-0 shadow-lift transition-opacity delay-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100 ${
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
        }`}
      >
        {label}
      </span>
    </span>
  );
}
