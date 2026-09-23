import { useEffect, useState } from 'react';
import { IconGrid } from './IconGrid';
import { IconGridSkeleton } from './IconSkeleton';
import { useInView } from '../../hooks/useInView';
import { isAbortError, searchIcons } from '../../services/iconifyService';
import type { CollectionInfo } from '../../types/icon';

interface RelatedIconsProps {
  title: string;
  query: string;
  prefixes?: string[];
  exclude: string;
  collections?: Record<string, CollectionInfo> | null;
  limit?: number;
}

/** A small live search section, loaded only when scrolled into view. */
export function RelatedIcons({ title, query, prefixes, exclude, collections, limit = 16 }: RelatedIconsProps) {
  const { ref, inView } = useInView<HTMLElement>('200px');
  const [icons, setIcons] = useState<string[] | null>(null);
  const prefixKey = prefixes?.join(',') ?? '';

  useEffect(() => {
    if (!inView || !query) return;
    const controller = new AbortController();
    setIcons(null);
    searchIcons({ query, page: 0, pageSize: 48, prefixes: prefixKey ? prefixKey.split(',') : undefined, signal: controller.signal })
      .then((result) => setIcons(result.icons.filter((n) => n !== exclude).slice(0, limit)))
      .catch((error) => !isAbortError(error) && setIcons([]));
    return () => controller.abort();
  }, [inView, query, prefixKey, exclude, limit]);

  if (icons && icons.length === 0) return null;

  return (
    <section ref={ref} className="mt-12" aria-label={title}>
      <h2 className="mb-4 text-lg font-bold tracking-tight">{title}</h2>
      {icons ? <IconGrid icons={icons} collections={collections} label={title} /> : <IconGridSkeleton count={8} />}
    </section>
  );
}
