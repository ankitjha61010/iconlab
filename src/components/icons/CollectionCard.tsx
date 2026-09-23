import { memo } from 'react';
import { Link } from 'react-router-dom';
import { Palette } from 'lucide-react';
import { IconPreview } from './IconPreview';
import type { CollectionInfo } from '../../types/icon';

export const CollectionCard = memo(function CollectionCard({ collection }: { collection: CollectionInfo }) {
  const samples = (collection.samples ?? []).slice(0, 6);
  return (
    <Link
      to={`/collections/${collection.prefix}`}
      className="group flex h-full flex-col rounded-2xl border border-border bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lift"
    >
      <div className="grid grid-cols-6 gap-1 rounded-xl bg-surface-2 p-3 text-text">
        {samples.map((sample) => (
          <IconPreview key={sample} name={`${collection.prefix}:${sample}`} className="mx-auto h-6 w-6" label={sample} />
        ))}
      </div>
      <div className="mt-3.5 flex items-start justify-between gap-2">
        <h3 className="font-semibold leading-snug group-hover:text-primary">{collection.name}</h3>
        {collection.palette && (
          <span className="mt-0.5 shrink-0 text-muted" title="Multicolor icon set">
            <Palette size={15} aria-label="Multicolor" />
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-muted">
        {collection.total?.toLocaleString()} icons{collection.author?.name ? ` · by ${collection.author.name}` : ''}
      </p>
      {collection.license?.title && (
        <span className="mt-3 inline-flex w-fit rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
          {collection.license.title}
        </span>
      )}
    </Link>
  );
});
