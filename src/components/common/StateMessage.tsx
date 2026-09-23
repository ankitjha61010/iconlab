import type { ReactNode } from 'react';

interface StateMessageProps {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  tone?: 'neutral' | 'danger';
}

/** Shared layout for empty, error and not-found states. */
export function StateMessage({ icon, title, description, action, tone = 'neutral' }: StateMessageProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div
        className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl ${
          tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-primary-soft text-primary'
        }`}
        aria-hidden="true"
      >
        {icon}
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-1.5 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
