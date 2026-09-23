export function IconSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface" aria-hidden="true">
      <div className="flex aspect-square items-center justify-center">
        <div className="skeleton h-10 w-10 rounded-lg" />
      </div>
      <div className="space-y-1.5 border-t border-border px-3 py-2.5">
        <div className="skeleton h-3 w-3/4 rounded" />
        <div className="skeleton h-2.5 w-1/2 rounded" />
      </div>
    </div>
  );
}

/** 2–3 per row on phones, 4–6 on tablets, 6–8 on desktop. */
export const GRID_CLASSES =
  'grid grid-cols-2 min-[420px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-3 sm:gap-4';

export function IconGridSkeleton({ count = 24 }: { count?: number }) {
  return (
    <div className={GRID_CLASSES} role="status" aria-label="Loading icons">
      {Array.from({ length: count }, (_, i) => (
        <IconSkeleton key={i} />
      ))}
    </div>
  );
}
