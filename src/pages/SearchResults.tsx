import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Filter, PanelLeftClose, PanelLeftOpen, SearchX, X } from 'lucide-react';
import { IconFilters, isFiltered } from '../components/icons/IconFilters';
import { IconGrid } from '../components/icons/IconGrid';
import { IconGridSkeleton } from '../components/icons/IconSkeleton';
import { IconSearch } from '../components/icons/IconSearch';
import { CategoryCard } from '../components/icons/CategoryCard';
import { Button } from '../components/common/Button';
import { Modal } from '../components/common/Modal';
import { StateMessage } from '../components/common/StateMessage';
import { useIcons } from '../hooks/useIcons';
import { useCollections } from '../hooks/useCollections';
import { useDebounce } from '../hooks/useDebounce';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { getFriendlyErrorMessage } from '../services/iconifyService';
import { CATEGORIES, POPULAR_SEARCHES } from '../constants';
import type { ColorFilter, SearchFilters, SortOrder, StyleFilter } from '../types/icon';

const COLORS: ColorFilter[] = ['black', 'color', 'gradient'];
const STYLES: StyleFilter[] = ['outline', 'filled', 'duotone', 'lineal', 'hand-drawn'];
const LABELS: Record<string, string> = {
  black: 'Black',
  color: 'Colors',
  gradient: 'Gradient',
  outline: 'Outline',
  filled: 'Filled',
  duotone: 'Duotone',
  lineal: 'Lineal',
  'hand-drawn': 'Hand drawn',
  recent: 'Recent',
};

function readFilters(params: URLSearchParams): SearchFilters {
  const color = params.get('color') as ColorFilter | null;
  const style = params.get('style') as StyleFilter | null;
  const sort = params.get('sort') as SortOrder | null;
  const sets = (params.get('sets') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-z0-9-]+$/.test(s));
  return {
    color: color && COLORS.includes(color) ? color : null,
    style: style && STYLES.includes(style) ? style : null,
    prefixes: [...new Set(sets)],
    sort: sort === 'recent' ? 'recent' : 'popular',
  };
}

function writeFilters(params: URLSearchParams, filters: SearchFilters) {
  const next = new URLSearchParams(params);
  const set = (key: string, value: string | null) => (value ? next.set(key, value) : next.delete(key));
  set('color', filters.color);
  set('style', filters.style);
  set('sets', filters.prefixes.length ? filters.prefixes.join(',') : null);
  set('sort', filters.sort === 'popular' ? null : filters.sort);
  return next;
}

function BrowseState() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Browse icons</h1>
      <p className="mt-1 text-muted">Search for anything, or start with a popular topic.</p>
      <IconSearch variant="hero" autoFocus className="mt-6 max-w-2xl" />
      <div className="mt-4 flex flex-wrap gap-2">
        {POPULAR_SEARCHES.map((term) => (
          <Link
            key={term}
            to={`/icons?q=${term}`}
            className="rounded-full border border-border bg-surface px-3 py-1 text-sm capitalize hover:border-border-strong hover:bg-surface-2"
          >
            {term}
          </Link>
        ))}
      </div>
      <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-6">
        {CATEGORIES.map((c) => (
          <CategoryCard key={c.label} label={c.label} query={c.query} />
        ))}
      </div>
    </div>
  );
}

export default function SearchResults() {
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') ?? '').trim();
  const filters = useMemo(() => readFilters(params), [params]);
  // Rapid filter clicks are merged into a single request.
  const debouncedFilters = useDebounce(filters, 200);
  const { collections } = useCollections();
  const result = useIcons(query, debouncedFilters);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);

  const titleWord = query ? query.charAt(0).toUpperCase() + query.slice(1) : '';
  useDocumentMeta(
    query ? `${titleWord} Icons` : 'Browse Icons',
    query
      ? `Free ${query} icons in SVG, PNG and JPG. Customize color, size and rotation, then download or copy code.`
      : undefined,
  );

  const onFiltersChange = useCallback(
    (next: SearchFilters) => setParams(writeFilters(params, next), { replace: true }),
    [params, setParams],
  );

  const mergedCollections = useMemo(() => ({ ...result.collections, ...(collections ?? {}) }), [result.collections, collections]);
  const activeChips = [
    ...(filters.color ? [{ key: 'color', label: LABELS[filters.color], clear: { ...filters, color: null } }] : []),
    ...(filters.style ? [{ key: 'style', label: LABELS[filters.style], clear: { ...filters, style: null } }] : []),
    ...filters.prefixes.map((p) => ({
      key: `set-${p}`,
      label: mergedCollections[p]?.name ?? p,
      clear: { ...filters, prefixes: filters.prefixes.filter((x) => x !== p) },
    })),
    ...(filters.sort === 'recent' ? [{ key: 'sort', label: 'Sort: Recent', clear: { ...filters, sort: 'popular' as const } }] : []),
  ];

  if (!query) return <BrowseState />;

  const filterPanel = (
    <IconFilters filters={filters} onChange={onFiltersChange} prefixCounts={result.prefixCounts} collections={mergedCollections} />
  );
  const loading = result.status === 'loading' || result.status === 'idle';
  const filteredCount = activeChips.length;

  return (
    <div className="mx-auto max-w-[96rem] px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex gap-8">
        {/* Sidebar: always on desktop, collapsible on tablet, sheet on mobile */}
        {sidebarOpen && (
          <aside aria-label="Filters" className="sticky top-24 hidden max-h-[calc(100vh-7rem)] w-64 shrink-0 self-start overflow-y-auto pr-1 md:block">
            {filterPanel}
          </aside>
        )}

        <div className="min-w-0 flex-1">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen((o) => !o)}
              className="hidden h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted hover:text-text md:inline-flex"
              aria-label={sidebarOpen ? 'Hide filters' : 'Show filters'}
              aria-expanded={sidebarOpen}
            >
              {sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{titleWord} Icons</h1>
              <p className="text-sm text-muted" aria-live="polite">
                {loading
                  ? 'Searching…'
                  : result.status === 'error'
                    ? 'Search unavailable'
                    : `${result.icons.length.toLocaleString()}${result.hasMore ? '+' : ''} icons`}
              </p>
            </div>
          </div>

          {activeChips.length > 0 && (
            <div className="mb-5 flex flex-wrap items-center gap-2">
              {activeChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => onFiltersChange(chip.clear)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary hover:opacity-80"
                  aria-label={`Remove filter ${chip.label}`}
                >
                  {chip.label} <X size={12} aria-hidden="true" />
                </button>
              ))}
              <button
                type="button"
                onClick={() => onFiltersChange({ color: null, style: null, prefixes: [], sort: 'popular' })}
                className="text-xs font-medium text-muted hover:text-text hover:underline"
              >
                Clear all
              </button>
            </div>
          )}

          {loading && <IconGridSkeleton count={24} />}

          {result.status === 'error' && (
            <StateMessage
              tone="danger"
              icon={<AlertTriangle size={26} />}
              title="Something went wrong"
              description={getFriendlyErrorMessage(result.error)}
              action={<Button onClick={result.retry}>Try again</Button>}
            />
          )}

          {(result.status === 'success' || result.status === 'loading-more') && result.icons.length === 0 && (
            <StateMessage
              icon={<SearchX size={26} />}
              title={`No icons found for “${query}”`}
              description={
                isFiltered(filters)
                  ? 'Try removing some filters, or search for a broader term.'
                  : 'Check the spelling or try a more general word, like “arrow” or “user”.'
              }
              action={
                isFiltered(filters) ? (
                  <Button variant="outline" onClick={() => onFiltersChange({ color: null, style: null, prefixes: [], sort: 'popular' })}>
                    Clear filters
                  </Button>
                ) : (
                  <div className="flex flex-wrap justify-center gap-2">
                    {POPULAR_SEARCHES.slice(0, 5).map((term) => (
                      <Link key={term} to={`/icons?q=${term}`} className="rounded-full border border-border px-3 py-1 text-sm capitalize hover:bg-surface-2">
                        {term}
                      </Link>
                    ))}
                  </div>
                )
              }
            />
          )}

          {result.icons.length > 0 && (
            <IconGrid
              icons={result.icons}
              collections={mergedCollections}
              hasMore={result.hasMore}
              loadingMore={result.status === 'loading-more'}
              loadMoreFailed={!!result.error}
              onLoadMore={result.loadMore}
              label={`${titleWord} icons`}
            />
          )}
        </div>
      </div>

      {/* Mobile filter button */}
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="fixed bottom-5 left-1/2 z-30 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-header px-5 py-3 text-sm font-semibold text-header-text shadow-lift md:hidden"
      >
        <Filter size={16} aria-hidden="true" /> Filters
        {filteredCount > 0 && <span className="rounded-full bg-primary px-1.5 text-xs text-primary-contrast">{filteredCount}</span>}
      </button>
      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} title="Filters" variant="sheet">
        {filterPanel}
        <Button className="mt-4 w-full" onClick={() => setSheetOpen(false)}>
          Show results
        </Button>
      </Modal>
    </div>
  );
}
