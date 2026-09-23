import { Heart } from 'lucide-react';
import { useIsFavorite } from '../../hooks/useFavorites';
import { humanizeIconName } from '../../services/iconifyService';
import { useToast } from '../common/Toast';

interface FavoriteButtonProps {
  name: string;
  variant?: 'floating' | 'button';
  className?: string;
}

export function FavoriteButton({ name, variant = 'floating', className = '' }: FavoriteButtonProps) {
  const [active, toggle] = useIsFavorite(name);
  const notify = useToast();
  const label = `${active ? 'Remove' : 'Add'} ${humanizeIconName(name)} ${active ? 'from' : 'to'} favorites`;

  const onClick = () => {
    toggle();
    notify(active ? 'Removed from favorites' : 'Added to favorites');
  };

  if (variant === 'button') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-label={label}
        className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors ${
          active
            ? 'border-transparent bg-danger-soft text-danger'
            : 'border-border bg-surface text-text hover:border-border-strong hover:bg-surface-2'
        } ${className}`}
      >
        <Heart size={16} className={active ? 'fill-current' : ''} aria-hidden="true" />
        {active ? 'Favorited' : 'Favorite'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={active ? 'Remove from favorites' : 'Add to favorites'}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface shadow-soft transition-all hover:scale-105 ${
        active ? 'text-danger' : 'text-muted hover:text-text'
      } ${className}`}
    >
      <Heart size={15} className={active ? 'fill-current' : ''} aria-hidden="true" />
    </button>
  );
}
