import { memo } from 'react';
import { Link } from 'react-router-dom';
import { SlidersHorizontal } from 'lucide-react';
import { IconPreview } from './IconPreview';
import { FavoriteButton } from './FavoriteButton';
import { humanizeIconName, parseIconName } from '../../services/iconifyService';
import type { IconName } from '../../types/icon';

interface IconCardProps {
  name: IconName;
  collectionName?: string;
}

export const IconCard = memo(function IconCard({ name, collectionName }: IconCardProps) {
  const parsed = parseIconName(name);
  if (!parsed) return null;
  const href = `/icon/${parsed.prefix}/${parsed.name}`;
  const title = humanizeIconName(parsed.name);

  return (
    <article className="group relative overflow-hidden rounded-xl border border-border bg-surface transition-all duration-150 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lift focus-within:border-primary">
      <Link to={href} className="block focus-visible:outline-none" aria-label={`${title} icon from ${collectionName ?? parsed.prefix}`}>
        <div className="flex aspect-square items-center justify-center transition-colors group-hover:bg-surface-2/70">
          <IconPreview name={name} label={`${title} icon`} className="h-10 w-10 text-text transition-transform duration-150 group-hover:scale-110 sm:h-11 sm:w-11" />
        </div>
        <div className="border-t border-border px-3 py-2.5">
          <h3 className="truncate text-[13px] font-medium leading-tight">{title}</h3>
          <p className="mt-0.5 truncate text-xs text-muted">{collectionName ?? parsed.prefix}</p>
        </div>
      </Link>

      <FavoriteButton
        name={name}
        className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-pressed:opacity-100 [@media(hover:none)]:opacity-100"
      />
      <Link
        to={href}
        state={{ focusEditor: true }}
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-x-2 bottom-[3.6rem] flex translate-y-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-1.5 text-xs font-semibold text-primary-contrast opacity-0 shadow-soft transition-all group-hover:translate-y-0 group-hover:opacity-100 [@media(hover:none)]:hidden"
      >
        <SlidersHorizontal size={13} /> Customize
      </Link>
    </article>
  );
});
