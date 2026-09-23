import { useCallback } from 'react';
import { createPersistentStore, isStringArray, useStore } from '../utils/storage';

const MAX_SEARCHES = 8;
const searchesStore = createPersistentStore<string[]>('iconlab:recent-searches', [], isStringArray);

export function useRecentSearches() {
  const searches = useStore(searchesStore);

  const addSearch = useCallback((query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return;
    searchesStore.set((prev) => [q, ...prev.filter((s) => s !== q)].slice(0, MAX_SEARCHES));
  }, []);

  const removeSearch = useCallback((query: string) => {
    searchesStore.set((prev) => prev.filter((s) => s !== query));
  }, []);

  const clearSearches = useCallback(() => searchesStore.set([]), []);

  return { searches, addSearch, removeSearch, clearSearches };
}
