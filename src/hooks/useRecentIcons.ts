import { useCallback } from 'react';
import type { IconName, RecentIcon } from '../types/icon';
import { createPersistentStore, useStore } from '../utils/storage';

const MAX_RECENT = 20;

const isRecentList = (value: unknown): value is RecentIcon[] =>
  Array.isArray(value) &&
  value.every((item) => item && typeof item.name === 'string' && typeof item.viewedAt === 'number');

const recentStore = createPersistentStore<RecentIcon[]>('iconlab:recent-icons', [], isRecentList);

export function useRecentIcons() {
  const recent = useStore(recentStore);

  const addRecent = useCallback((name: IconName) => {
    recentStore.set((prev) => [{ name, viewedAt: Date.now() }, ...prev.filter((r) => r.name !== name)].slice(0, MAX_RECENT));
  }, []);

  const clearRecent = useCallback(() => recentStore.set([]), []);

  return { recent, addRecent, clearRecent };
}
