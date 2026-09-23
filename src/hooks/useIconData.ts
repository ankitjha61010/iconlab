import { useEffect, useState } from 'react';
import { getCachedIcon, loadIcon } from '../services/iconifyService';
import type { IconData, IconName } from '../types/icon';

/**
 * Icon data for rendering. `undefined` = not loaded yet, `null` = unavailable.
 * Nothing is fetched until `enabled` is true (e.g. when the card is visible).
 */
export function useIconData(name: IconName, enabled = true): IconData | null | undefined {
  const [data, setData] = useState<IconData | null | undefined>(() => getCachedIcon(name));

  useEffect(() => {
    const cached = getCachedIcon(name);
    if (cached !== undefined) {
      setData(cached);
      return;
    }
    setData(undefined);
    if (!enabled) return;
    let active = true;
    loadIcon(name).then((result) => {
      if (active) setData(result);
    });
    return () => {
      active = false;
    };
  }, [name, enabled]);

  return data;
}
