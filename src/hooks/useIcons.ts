import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getCollections,
  getLastModified,
  isAbortError,
  loadIcons,
  parseIconName,
  searchIcons,
} from '../services/iconifyService';
import type { CollectionInfo, IconName, SearchFilters } from '../types/icon';

export const PAGE_SIZE = 48;
/** For client-side filters (gradient) keep fetching until a page has enough matches. */
const MIN_FILTERED_PAGE = 16;
const MAX_EXTRA_PAGES = 4;

export type LoadStatus = 'idle' | 'loading' | 'loading-more' | 'success' | 'error';

interface State {
  icons: IconName[];
  status: LoadStatus;
  error: unknown;
  hasMore: boolean;
  nextPage: number;
  /** prefix → number of loaded results from that collection */
  prefixCounts: Record<string, number>;
  collections: Record<string, CollectionInfo>;
}

const initialState: State = {
  icons: [],
  status: 'idle',
  error: null,
  hasMore: false,
  nextPage: 0,
  prefixCounts: {},
  collections: {},
};

const HAND_DRAWN_PATTERN = /freehand|hand[- ]?drawn|doodle|sketch|pencil|scribble/i;

/** Collections whose metadata marks them as hand drawn. */
async function handDrawnPrefixes(): Promise<string[]> {
  const all = await getCollections();
  return Object.values(all)
    .filter((c) => HAND_DRAWN_PATTERN.test(`${c.name} ${(c.tags ?? []).join(' ')}`))
    .map((c) => c.prefix);
}

/**
 * Translates UI filters into Iconify search keywords/prefixes.
 * Returns null when the combination can't match anything.
 */
async function buildRequest(filters: SearchFilters): Promise<{ keywords: string[]; prefixes: string[] } | null> {
  const keywords: string[] = [];
  let prefixes = [...filters.prefixes];

  if (filters.color === 'black') keywords.push('palette:false');
  if (filters.color === 'color' || filters.color === 'gradient') keywords.push('palette:true');

  switch (filters.style) {
    case 'outline':
      keywords.push('style:stroke');
      break;
    case 'filled':
      keywords.push('style:fill');
      break;
    case 'duotone':
      keywords.push('duotone');
      break;
    case 'lineal':
      keywords.push('line');
      break;
    case 'hand-drawn': {
      const hand = await handDrawnPrefixes();
      prefixes = prefixes.length ? prefixes.filter((p) => hand.includes(p)) : hand;
      if (!prefixes.length) return null;
      break;
    }
  }
  return { keywords, prefixes };
}

async function fetchPage(query: string, filters: SearchFilters, page: number, signal: AbortSignal) {
  const request = await buildRequest(filters);
  if (!request) return { icons: [] as IconName[], hasMore: false, nextPage: page, collections: {} };

  let current = page;
  let icons: IconName[] = [];
  let hasMore = false;
  let collections: Record<string, CollectionInfo> = {};

  for (let tries = 0; tries <= MAX_EXTRA_PAGES; tries++) {
    const result = await searchIcons({ query, page: current, pageSize: PAGE_SIZE, signal, ...request });
    collections = { ...collections, ...result.collections };
    let batch = result.icons;
    hasMore = result.hasMore;
    current++;

    if (filters.color === 'gradient') {
      // Iconify has no gradient flag: inspect the actual SVG bodies.
      const data = await loadIcons(batch);
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      batch = batch.filter((_, i) => data[i] && /<(linear|radial)Gradient\b/i.test(data[i]!.body));
      icons = icons.concat(batch);
      if (icons.length >= MIN_FILTERED_PAGE || !hasMore) break;
    } else {
      icons = batch;
      break;
    }
  }

  if (filters.sort === 'recent' && icons.length) {
    const prefixes = [...new Set(icons.map((n) => parseIconName(n)?.prefix).filter((p): p is string => !!p))];
    const modified = await getLastModified(prefixes, signal);
    const prefixOf = (n: string) => n.slice(0, n.indexOf(':'));
    icons = icons
      .map((name, index) => ({ name, index, at: modified[prefixOf(name)] ?? 0 }))
      .sort((a, b) => b.at - a.at || a.index - b.index)
      .map((entry) => entry.name);
  }

  return { icons, hasMore, nextPage: current, collections };
}

function countPrefixes(icons: IconName[], base: Record<string, number> = {}) {
  const counts = { ...base };
  for (const name of icons) {
    const prefix = name.slice(0, name.indexOf(':'));
    counts[prefix] = (counts[prefix] ?? 0) + 1;
  }
  return counts;
}

/** Debounced-input-friendly search with pagination, cancellation and caching. */
export function useIcons(query: string, filters: SearchFilters) {
  const [state, setState] = useState<State>(initialState);
  const controllerRef = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const filtersKey = JSON.stringify(filters);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    controllerRef.current?.abort();
    const trimmed = query.trim();
    if (!trimmed) {
      setState(initialState);
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    const parsedFilters = JSON.parse(filtersKey) as SearchFilters;
    setState({ ...initialState, status: 'loading' });

    fetchPage(trimmed, parsedFilters, 0, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setState({
          icons: page.icons,
          status: 'success',
          error: null,
          hasMore: page.hasMore,
          nextPage: page.nextPage,
          prefixCounts: countPrefixes(page.icons),
          collections: page.collections,
        });
      })
      .catch((error) => {
        if (isAbortError(error) || controller.signal.aborted) return;
        setState({ ...initialState, status: 'error', error });
      });

    return () => controller.abort();
  }, [query, filtersKey, retryToken]);

  const loadMore = useCallback(() => {
    const current = stateRef.current;
    if (current.status !== 'success' || !current.hasMore) return;
    const controller = controllerRef.current;
    if (!controller || controller.signal.aborted) return;
    setState((s) => ({ ...s, status: 'loading-more', error: null }));

    fetchPage(query.trim(), JSON.parse(filtersKey) as SearchFilters, current.nextPage, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setState((s) => {
          const seen = new Set(s.icons);
          const fresh = page.icons.filter((n) => !seen.has(n));
          return {
            ...s,
            icons: s.icons.concat(fresh),
            status: 'success',
            hasMore: page.hasMore,
            nextPage: page.nextPage,
            prefixCounts: countPrefixes(fresh, s.prefixCounts),
            collections: { ...s.collections, ...page.collections },
          };
        });
      })
      .catch((error) => {
        if (isAbortError(error) || controller.signal.aborted) return;
        // Keep what's already loaded; allow another attempt.
        setState((s) => ({ ...s, status: 'success', hasMore: true, error }));
      });
  }, [query, filtersKey]);

  const retry = useCallback(() => setRetryToken((t) => t + 1), []);

  return { ...state, loadMore, retry };
}
