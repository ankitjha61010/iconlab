/**
 * Iconify API client.
 *
 * Every network call to Iconify lives in this module. The public Iconify API
 * requires no API key, so the browser calls it directly. If a future provider
 * requires a secret key, it must go through a backend/proxy — a key shipped in
 * frontend code is visible to every visitor.
 */
import type {
  CollectionIcons,
  CollectionInfo,
  IconData,
  IconName,
  SearchParams,
  SearchResult,
} from '../types/icon';

/** Public Iconify API hosts, tried in order when one is unreachable. */
const API_HOSTS = ['https://api.iconify.design', 'https://api.simplesvg.com', 'https://api.unisvg.com'];

/** Iconify caps the search `limit` parameter at 999. */
const MAX_SEARCH_LIMIT = 999;
const MIN_SEARCH_LIMIT = 32;
const MAX_QUERY_URL_LENGTH = 1800;
const DEFAULT_ICON_SIZE = 16;

export type IconifyErrorKind = 'network' | 'rate_limited' | 'not_found' | 'invalid_response' | 'unavailable';

export class IconifyError extends Error {
  readonly kind: IconifyErrorKind;
  constructor(kind: IconifyErrorKind, message?: string) {
    super(message ?? kind);
    this.name = 'IconifyError';
    this.kind = kind;
  }
}

/** User-facing messages. Raw API errors are never shown in the UI. */
export function getFriendlyErrorMessage(error: unknown): string {
  if (error instanceof IconifyError) {
    switch (error.kind) {
      case 'rate_limited':
        return 'You are searching a little too fast. Please wait a moment and try again.';
      case 'not_found':
        return 'We couldn’t find that icon or collection.';
      case 'network':
        return 'You appear to be offline. Check your connection and try again.';
      default:
        return 'Unable to load icons right now. Please try again.';
    }
  }
  return 'Unable to load icons right now. Please try again.';
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

// ---------------------------------------------------------------------------
// Low-level request
// ---------------------------------------------------------------------------

let preferredHost = 0;

async function request<T>(path: string, params: Record<string, string | undefined>, signal?: AbortSignal): Promise<T> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  const qs = search.toString();
  let lastError: unknown = new IconifyError('unavailable');

  for (let attempt = 0; attempt < API_HOSTS.length; attempt++) {
    const hostIndex = (preferredHost + attempt) % API_HOSTS.length;
    const url = `${API_HOSTS[hostIndex]}${path}${qs ? `?${qs}` : ''}`;
    let response: Response;
    try {
      response = await fetch(url, { signal });
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastError = new IconifyError(navigator.onLine === false ? 'network' : 'unavailable');
      continue;
    }

    if (response.status === 429) throw new IconifyError('rate_limited');
    if (response.status === 404) throw new IconifyError('not_found');
    if (response.status >= 500) {
      lastError = new IconifyError('unavailable');
      continue;
    }
    if (!response.ok) throw new IconifyError('invalid_response', `HTTP ${response.status}`);

    const text = await response.text();
    // Iconify answers unknown resources with a bare "404" body.
    if (text.trim() === '404') throw new IconifyError('not_found');
    try {
      preferredHost = hostIndex;
      return JSON.parse(text) as T;
    } catch {
      throw new IconifyError('invalid_response');
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const NAME_PART = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseIconName(full: string): { prefix: string; name: string } | null {
  const index = full.indexOf(':');
  if (index <= 0) return null;
  const prefix = full.slice(0, index);
  const name = full.slice(index + 1);
  if (!NAME_PART.test(prefix) || !NAME_PART.test(name)) return null;
  return { prefix, name };
}

export function toIconName(prefix: string, name: string): IconName {
  return `${prefix}:${name}`;
}

/** "arrow-left-bold" → "Arrow left bold" */
export function humanizeIconName(name: string): string {
  const bare = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
  const words = bare.replace(/-/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

interface RawSearchResponse {
  icons?: unknown;
  total?: number;
  collections?: Record<string, CollectionInfo>;
}

const searchCache = new Map<string, SearchResult>();

export async function searchIcons({
  query,
  page,
  pageSize,
  prefixes,
  keywords,
  signal,
}: SearchParams): Promise<SearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { icons: [], total: 0, hasMore: false, collections: {} };

  const start = page * pageSize;
  const limit = Math.min(MAX_SEARCH_LIMIT, Math.max(MIN_SEARCH_LIMIT, start + pageSize));
  if (start >= limit) return { icons: [], total: 0, hasMore: false, collections: {} };

  const fullQuery = [trimmed, ...(keywords ?? [])].join(' ');
  const prefixParam = prefixes && prefixes.length ? prefixes.join(',') : undefined;
  const cacheKey = `${fullQuery}|${prefixParam ?? ''}|${start}|${limit}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const raw = await request<RawSearchResponse>(
    '/search',
    { query: fullQuery, limit: String(limit), start: start ? String(start) : undefined, prefixes: prefixParam },
    signal,
  );
  if (!Array.isArray(raw.icons)) throw new IconifyError('invalid_response');

  const icons = raw.icons.filter((n): n is string => typeof n === 'string' && parseIconName(n) !== null).slice(0, pageSize);
  const result: SearchResult = {
    icons,
    total: typeof raw.total === 'number' ? raw.total : icons.length,
    hasMore: raw.icons.length >= Math.min(pageSize, limit - start) && limit < MAX_SEARCH_LIMIT,
    collections: raw.collections ?? {},
  };
  searchCache.set(cacheKey, result);
  return result;
}

/**
 * Keyword suggestions derived from real search results: the distinct words
 * of matching icon names that start with what the user typed.
 */
export async function getSearchSuggestions(query: string, signal?: AbortSignal): Promise<string[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const { icons } = await searchIcons({ query: q, page: 0, pageSize: 96, signal });
  const counts = new Map<string, number>();
  for (const full of icons) {
    const parsed = parseIconName(full);
    if (!parsed) continue;
    const words = parsed.name.split('-');
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (word.startsWith(q) && word.length > 1 && !/^\d+$/.test(word)) {
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
      const pair = words.slice(i, i + 2).join(' ');
      if (i + 1 < words.length && pair.startsWith(q) && !/\d/.test(pair)) {
        counts.set(pair, (counts.get(pair) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .map(([word]) => word)
    .filter((word) => word !== q)
    .slice(0, 6);
}

// ---------------------------------------------------------------------------
// Icon data (batched + cached)
// ---------------------------------------------------------------------------

interface RawIconEntry {
  body: string;
  width?: number;
  height?: number;
  left?: number;
  top?: number;
  rotate?: number;
  hFlip?: boolean;
  vFlip?: boolean;
  hidden?: boolean;
}

interface RawAliasEntry extends Omit<RawIconEntry, 'body'> {
  parent: string;
}

interface RawIconSet {
  prefix: string;
  icons?: Record<string, RawIconEntry>;
  aliases?: Record<string, RawAliasEntry>;
  width?: number;
  height?: number;
  left?: number;
  top?: number;
  not_found?: string[];
}

/** name → resolved data, or null when Iconify reported it missing. */
const iconCache = new Map<IconName, IconData | null>();
const pending = new Map<string, Set<string>>();
const waiters = new Map<IconName, Array<(data: IconData | null) => void>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function resolveIcon(set: RawIconSet, name: string, depth = 0): IconData | null {
  if (depth > 6) return null;
  const icon = set.icons?.[name];
  if (icon && typeof icon.body === 'string') {
    return {
      prefix: set.prefix,
      name,
      body: icon.body,
      width: icon.width ?? set.width ?? DEFAULT_ICON_SIZE,
      height: icon.height ?? set.height ?? DEFAULT_ICON_SIZE,
      left: icon.left ?? set.left ?? 0,
      top: icon.top ?? set.top ?? 0,
      rotate: icon.rotate,
      hFlip: icon.hFlip,
      vFlip: icon.vFlip,
    };
  }
  const alias = set.aliases?.[name];
  if (alias) {
    const parent = resolveIcon(set, alias.parent, depth + 1);
    if (!parent) return null;
    return {
      ...parent,
      name,
      width: alias.width ?? parent.width,
      height: alias.height ?? parent.height,
      left: alias.left ?? parent.left,
      top: alias.top ?? parent.top,
      rotate: ((parent.rotate ?? 0) + (alias.rotate ?? 0)) % 4 || undefined,
      hFlip: !!parent.hFlip !== !!alias.hFlip || undefined,
      vFlip: !!parent.vFlip !== !!alias.vFlip || undefined,
    };
  }
  return null;
}

function settle(full: IconName, data: IconData | null) {
  iconCache.set(full, data);
  const list = waiters.get(full);
  waiters.delete(full);
  list?.forEach((resolve) => resolve(data));
}

async function fetchPrefix(prefix: string, names: string[]) {
  // Split into chunks so the URL stays well within safe limits.
  const chunks: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const name of names) {
    if (length + name.length + 1 > MAX_QUERY_URL_LENGTH && current.length) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(name);
    length += name.length + 1;
  }
  if (current.length) chunks.push(current);

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const set = await request<RawIconSet>(`/${prefix}.json`, { icons: chunk.join(',') });
        for (const name of chunk) settle(toIconName(prefix, name), resolveIcon({ ...set, prefix }, name));
      } catch (error) {
        const missing = error instanceof IconifyError && error.kind === 'not_found';
        for (const name of chunk) {
          const full = toIconName(prefix, name);
          if (missing) {
            settle(full, null);
          } else {
            // Transient failure: don't cache, let a later call retry.
            const list = waiters.get(full);
            waiters.delete(full);
            list?.forEach((resolve) => resolve(null));
          }
        }
      }
    }),
  );
}

function flush() {
  flushTimer = null;
  const batch = new Map(pending);
  pending.clear();
  batch.forEach((names, prefix) => void fetchPrefix(prefix, [...names]));
}

/** Returns cached icon data synchronously, or undefined when not loaded yet. */
export function getCachedIcon(full: IconName): IconData | null | undefined {
  return iconCache.get(full);
}

/**
 * Loads a single icon. Calls made within the same tick are merged into one
 * request per icon set, so a grid of 48 icons costs only a handful of requests.
 */
export function loadIcon(full: IconName): Promise<IconData | null> {
  const cached = iconCache.get(full);
  if (cached !== undefined) return Promise.resolve(cached);
  const parsed = parseIconName(full);
  if (!parsed) return Promise.resolve(null);

  return new Promise((resolve) => {
    const list = waiters.get(full);
    if (list) {
      list.push(resolve);
      return;
    }
    waiters.set(full, [resolve]);
    let names = pending.get(parsed.prefix);
    if (!names) {
      names = new Set();
      pending.set(parsed.prefix, names);
    }
    names.add(parsed.name);
    if (!flushTimer) flushTimer = setTimeout(flush, 20);
  });
}

export function loadIcons(names: IconName[]): Promise<Array<IconData | null>> {
  return Promise.all(names.map(loadIcon));
}

/** Loads one icon and throws a typed error when it doesn't exist. */
export async function getIcon(prefix: string, name: string, signal?: AbortSignal): Promise<IconData> {
  const full = toIconName(prefix, name);
  if (!parseIconName(full)) throw new IconifyError('not_found');
  const cached = iconCache.get(full);
  if (cached) return cached;
  const set = await request<RawIconSet>(`/${prefix}.json`, { icons: name }, signal);
  const data = resolveIcon({ ...set, prefix }, name);
  if (!data) throw new IconifyError('not_found');
  iconCache.set(full, data);
  return data;
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

const COLLECTIONS_STORAGE_KEY = 'iconlab:collections:v1';
const COLLECTIONS_TTL = 1000 * 60 * 60 * 12;
let collectionsPromise: Promise<Record<string, CollectionInfo>> | null = null;

/** All public icon sets. Cached in memory and in sessionStorage. */
export function getCollections(): Promise<Record<string, CollectionInfo>> {
  if (collectionsPromise) return collectionsPromise;
  collectionsPromise = (async () => {
    try {
      const stored = sessionStorage.getItem(COLLECTIONS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as { at: number; data: Record<string, CollectionInfo> };
        if (Date.now() - parsed.at < COLLECTIONS_TTL && parsed.data) return parsed.data;
      }
    } catch {
      /* storage unavailable */
    }
    const raw = await request<Record<string, Omit<CollectionInfo, 'prefix'>>>('/collections', {});
    if (!raw || typeof raw !== 'object') throw new IconifyError('invalid_response');
    const data: Record<string, CollectionInfo> = {};
    for (const [prefix, info] of Object.entries(raw)) {
      if (info && typeof info.name === 'string') data[prefix] = { ...info, prefix };
    }
    try {
      sessionStorage.setItem(COLLECTIONS_STORAGE_KEY, JSON.stringify({ at: Date.now(), data }));
    } catch {
      /* quota exceeded — memory cache still works */
    }
    return data;
  })().catch((error) => {
    collectionsPromise = null;
    throw error;
  });
  return collectionsPromise;
}

const collectionInfoCache = new Map<string, CollectionInfo | null>();

/** Metadata (name, author, license) for one icon set. */
export async function getCollectionInfo(prefix: string): Promise<CollectionInfo | null> {
  if (collectionInfoCache.has(prefix)) return collectionInfoCache.get(prefix) ?? null;
  try {
    const all = await getCollections();
    if (all[prefix]) {
      collectionInfoCache.set(prefix, all[prefix]);
      return all[prefix];
    }
  } catch {
    /* fall through to the single-prefix lookup */
  }
  const raw = await request<Record<string, Omit<CollectionInfo, 'prefix'>>>('/collections', { prefixes: prefix });
  const info = raw?.[prefix] ? { ...raw[prefix], prefix } : null;
  collectionInfoCache.set(prefix, info);
  return info;
}

interface RawCollection {
  prefix: string;
  total?: number;
  title?: string;
  info?: Omit<CollectionInfo, 'prefix'>;
  uncategorized?: string[];
  categories?: Record<string, string[]>;
  hidden?: string[];
}

const collectionCache = new Map<string, CollectionIcons>();

/** The full list of icon names in a set, grouped by category when available. */
export async function getCollectionIcons(prefix: string, signal?: AbortSignal): Promise<CollectionIcons> {
  const cached = collectionCache.get(prefix);
  if (cached) return cached;
  const raw = await request<RawCollection>('/collection', { prefix, info: 'true' }, signal);
  if (!raw || typeof raw !== 'object' || raw.prefix !== prefix) throw new IconifyError('invalid_response');

  const categories = raw.categories ?? {};
  const seen = new Set<string>();
  const icons: string[] = [];
  for (const list of Object.values(categories)) {
    for (const name of list) if (!seen.has(name)) seen.add(name) && icons.push(name);
  }
  for (const name of raw.uncategorized ?? []) if (!seen.has(name)) seen.add(name) && icons.push(name);

  const result: CollectionIcons = {
    prefix,
    title: raw.title ?? raw.info?.name ?? prefix,
    total: raw.total ?? icons.length,
    info: raw.info ? { ...raw.info, prefix } : undefined,
    categories,
    icons,
  };
  collectionCache.set(prefix, result);
  return result;
}

/** Last update timestamps (unix seconds) for icon sets — used for "Recent" sorting. */
export async function getLastModified(prefixes: string[], signal?: AbortSignal): Promise<Record<string, number>> {
  if (!prefixes.length) return {};
  const raw = await request<{ lastModified?: Record<string, number> }>(
    '/last-modified',
    { prefixes: prefixes.join(',') },
    signal,
  );
  return raw.lastModified ?? {};
}
