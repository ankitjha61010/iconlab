import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { IconCard } from './IconCard';
import { GRID_CLASSES, IconSkeleton } from './IconSkeleton';
import { Button } from '../common/Button';
import type { CollectionInfo, IconName } from '../../types/icon';

interface IconGridProps {
  icons: IconName[];
  collections?: Record<string, CollectionInfo> | null;
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMoreFailed?: boolean;
  onLoadMore?: () => void;
  label?: string;
}

/** Responsive grid with infinite scroll (plus a manual "Load more" fallback). */
export function IconGrid({ icons, collections, hasMore, loadingMore, loadMoreFailed, onLoadMore, label = 'Icons' }: IconGridProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loadingMore || loadMoreFailed || !onLoadMore || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onLoadMore(), {
      rootMargin: '600px',
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loadMoreFailed, onLoadMore, icons.length]);

  return (
    <>
      <ul className={GRID_CLASSES} aria-label={label}>
        {icons.map((name) => {
          const prefix = name.slice(0, name.indexOf(':'));
          return (
            <li key={name}>
              <IconCard name={name} collectionName={collections?.[prefix]?.name} />
            </li>
          );
        })}
        {loadingMore &&
          Array.from({ length: 12 }, (_, i) => (
            <li key={`skeleton-${i}`}>
              <IconSkeleton />
            </li>
          ))}
      </ul>
      {hasMore && onLoadMore && (
        <div ref={sentinelRef} className="mt-8 flex flex-col items-center gap-2">
          {loadMoreFailed && <p className="text-sm text-muted">Unable to load more icons right now.</p>}
          <Button variant="outline" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
            {loadingMore ? 'Loading…' : loadMoreFailed ? 'Try again' : 'Load more icons'}
          </Button>
        </div>
      )}
    </>
  );
}
