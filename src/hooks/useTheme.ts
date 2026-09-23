import { useCallback, useEffect } from 'react';
import { createPersistentStore, useStore } from '../utils/storage';

export type Theme = 'light' | 'dark';

const systemTheme = (): Theme =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

// index.html reads the same key before first paint to avoid a theme flash.
const themeStore = createPersistentStore<Theme | null>(
  'iconlab:theme',
  null,
  (v): v is Theme | null => v === 'light' || v === 'dark' || v === null,
);

export function useTheme() {
  const stored = useStore(themeStore);
  const theme: Theme = stored ?? systemTheme();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const toggleTheme = useCallback(() => {
    themeStore.set((prev) => ((prev ?? systemTheme()) === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggleTheme };
}
