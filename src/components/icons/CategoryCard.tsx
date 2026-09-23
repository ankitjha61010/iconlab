import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { IconPreview } from './IconPreview';
import { useInView } from '../../hooks/useInView';
import { isAbortError, searchIcons } from '../../services/iconifyService';

interface CategoryCardProps {
  label: string;
  query: string;
}

/** A category tile that shows live search results for its query once visible. */
export function CategoryCard({ label, query }: CategoryCardProps) {
  const { ref, inView } = useInView<HTMLAnchorElement>('100px');
  const [icons, setIcons] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!inView) return;
    const controller = new AbortController();
    searchIcons({ query, page: 0, pageSize: 32, keywords: ['palette:false'], signal: controller.signal })
      .then((result) => {
        // One icon per collection gives a more varied, representative tile.
        const seen = new Set<string>();
        const picks = result.icons.filter((name) => {
          const prefix = name.slice(0, name.indexOf(':'));
          if (seen.has(prefix)) return false;
          seen.add(prefix);
          return true;
        });
        setIcons((picks.length >= 6 ? picks : result.icons).slice(0, 6));
      })
      .catch((error) => !isAbortError(error) && setFailed(true));
    return () => controller.abort();
  }, [inView, query]);

  return (
    <Link
      ref={ref}
      to={`/icons?q=${encodeURIComponent(query)}`}
      className="group flex flex-col rounded-2xl border border-border bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lift"
    >
      <div className="grid h-24 grid-cols-3 place-items-center gap-2 rounded-xl bg-surface-2 p-3 text-text transition-colors group-hover:bg-primary-soft group-hover:text-primary">
        {icons
          ? icons.map((name) => <IconPreview key={name} name={name} className="h-7 w-7" label={name} />)
          : !failed && Array.from({ length: 6 }, (_, i) => <span key={i} className="skeleton h-7 w-7 rounded-md" aria-hidden="true" />)}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <h3 className="font-semibold">{label}</h3>
        <ArrowRight size={16} className="text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
      </div>
    </Link>
  );
}
