import { useEffect, useState } from 'react';
import { getCollections } from '../services/iconifyService';
import type { CollectionInfo } from '../types/icon';

let snapshot: Record<string, CollectionInfo> | null = null;

/** All Iconify collections (loaded once, shared by every caller). */
export function useCollections() {
  const [collections, setCollections] = useState<Record<string, CollectionInfo> | null>(snapshot);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (snapshot) return;
    let active = true;
    setError(null);
    getCollections()
      .then((data) => {
        snapshot = data;
        if (active) setCollections(data);
      })
      .catch((e) => active && setError(e));
    return () => {
      active = false;
    };
  }, [attempt]);

  return { collections, error, loading: !collections && !error, retry: () => setAttempt((a) => a + 1) };
}
