import { useCallback, useMemo } from 'react';
import type { IconName } from '../types/icon';
import { createPersistentStore, isStringArray, useStore } from '../utils/storage';

/** Favorites are stored newest-first as Iconify identifiers. */
const favoritesStore = createPersistentStore<IconName[]>('iconlab:favorites', [], isStringArray);

export function useFavorites() {
  const favorites = useStore(favoritesStore);
  const lookup = useMemo(() => new Set(favorites), [favorites]);

  const isFavorite = useCallback((name: IconName) => lookup.has(name), [lookup]);

  const toggleFavorite = useCallback((name: IconName) => {
    favoritesStore.set((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [name, ...prev]));
  }, []);

  const removeFavorite = useCallback((name: IconName) => {
    favoritesStore.set((prev) => prev.filter((n) => n !== name));
  }, []);

  const clearFavorites = useCallback(() => favoritesStore.set([]), []);

  return { favorites, isFavorite, toggleFavorite, removeFavorite, clearFavorites };
}

/** Subscribes to a single icon only, so toggling one card doesn't re-render the grid. */
export function useIsFavorite(name: IconName): [boolean, () => void] {
  const favorites = useStore(favoritesStore);
  const active = favorites.includes(name);
  const toggle = useCallback(() => {
    favoritesStore.set((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [name, ...prev]));
  }, [name]);
  return [active, toggle];
}
