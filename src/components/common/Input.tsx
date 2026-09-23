import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leading?: ReactNode;
  trailing?: ReactNode;
  wrapperClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { leading, trailing, className = '', wrapperClassName = '', ...props },
  ref,
) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-border bg-surface px-3 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-[var(--ring)] ${wrapperClassName}`}
    >
      {leading && <span className="text-muted shrink-0">{leading}</span>}
      <input
        ref={ref}
        className={`h-10 w-full min-w-0 bg-transparent text-sm text-text placeholder:text-muted outline-none focus-visible:outline-none ${className}`}
        {...props}
      />
      {trailing}
    </div>
  );
});
