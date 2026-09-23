import { useState } from 'react';
import { Heart, Trash2 } from 'lucide-react';
import { IconGrid } from '../components/icons/IconGrid';
import { Button, ButtonLink } from '../components/common/Button';
import { Modal } from '../components/common/Modal';
import { StateMessage } from '../components/common/StateMessage';
import { useFavorites } from '../hooks/useFavorites';
import { useRecentIcons } from '../hooks/useRecentIcons';
import { useCollections } from '../hooks/useCollections';
import { useDocumentMeta } from '../hooks/useDocumentMeta';

export default function Favorites() {
  useDocumentMeta('Favorites', 'Your saved icons, stored privately in this browser.');
  const { favorites, clearFavorites } = useFavorites();
  const { recent } = useRecentIcons();
  const { collections } = useCollections();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Favorites</h1>
          <p className="mt-1 text-sm text-muted">
            {favorites.length
              ? `${favorites.length} saved icon${favorites.length === 1 ? '' : 's'} · stored in this browser, no account needed`
              : 'Saved icons are stored in this browser — no account needed.'}
          </p>
        </div>
        {favorites.length > 0 && (
          <Button variant="danger" icon={<Trash2 size={16} aria-hidden="true" />} onClick={() => setConfirmOpen(true)}>
            Clear all
          </Button>
        )}
      </div>

      {favorites.length ? (
        <IconGrid icons={favorites} collections={collections} label="Favorite icons" />
      ) : (
        <StateMessage
          icon={<Heart size={26} />}
          title="No favorites yet"
          description="Tap the heart on any icon to save it here. Your favorites survive page refreshes."
          action={<ButtonLink to="/icons">Browse icons</ButtonLink>}
        />
      )}

      {recent.length > 0 && (
        <section className="mt-14" aria-labelledby="recent-fav-heading">
          <h2 id="recent-fav-heading" className="mb-4 text-lg font-bold tracking-tight">
            Recently viewed
          </h2>
          <IconGrid icons={recent.map((r) => r.name)} collections={collections} label="Recently viewed icons" />
        </section>
      )}

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Clear all favorites?">
        <p className="text-sm text-muted">This removes all {favorites.length} saved icons from this browser. This can’t be undone.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              clearFavorites();
              setConfirmOpen(false);
            }}
          >
            Clear favorites
          </Button>
        </div>
      </Modal>
    </div>
  );
}
