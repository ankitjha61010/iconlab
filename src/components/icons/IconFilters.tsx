import { useId, useMemo, useState, type ReactNode } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { FEATURED_PREFIXES } from '../../constants';
import type { CollectionInfo, ColorFilter, SearchFilters, SortOrder, StyleFilter } from '../../types/icon';

interface IconFiltersProps {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
  /** Collections that appear in the loaded results, with counts. */
  prefixCounts: Record<string, number>;
  collections: Record<string, CollectionInfo> | null;
}

const COLOR_OPTIONS: Array<{ value: ColorFilter; label: string; hint: string; swatch: string }> = [
  { value: 'black', label: 'Black', hint: 'Single color icons you can recolor', swatch: 'bg-text' },
  { value: 'color', label: 'Colors', hint: 'Multicolor icon sets', swatch: 'bg-[conic-gradient(#f43f5e,#f59e0b,#22c55e,#3b82f6,#a855f7,#f43f5e)]' },
  { value: 'gradient', label: 'Gradient', hint: 'Multicolor icons that contain SVG gradients', swatch: 'brand-gradient' },
];

const STYLE_OPTIONS: Array<{ value: StyleFilter; label: string; hint: string }> = [
  { value: 'outline', label: 'Outline', hint: 'Stroke-based icons' },
  { value: 'filled', label: 'Filled', hint: 'Fill-based icons' },
  { value: 'duotone', label: 'Duotone', hint: 'Icons named “duotone”' },
  { value: 'lineal', label: 'Lineal', hint: 'Icons named “line”' },
  { value: 'hand-drawn', label: 'Hand drawn', hint: 'Freehand / pencil icon sets' },
];

const SORT_OPTIONS: Array<{ value: SortOrder; label: string; hint: string }> = [
  { value: 'popular', label: 'Popular', hint: 'Iconify relevance order' },
  { value: 'recent', label: 'Recent', hint: 'Recently updated icon sets first' },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="border-b border-border py-5 first:pt-0 last:border-0">
      <h3 id={id} className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'border-primary bg-primary-soft text-primary'
          : 'border-border bg-surface text-text hover:border-border-strong hover:bg-surface-2'
      }`}
    >
      {children}
    </button>
  );
}

export function isFiltered(filters: SearchFilters) {
  return !!(filters.color || filters.style || filters.prefixes.length || filters.sort !== 'popular');
}

export function IconFilters({ filters, onChange, prefixCounts, collections }: IconFiltersProps) {
  const [showAllSets, setShowAllSets] = useState(false);

  const setOptions = useMemo(() => {
    const fromResults = Object.entries(prefixCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([prefix]) => prefix);
    const ordered = [...new Set([...filters.prefixes, ...FEATURED_PREFIXES, ...fromResults])];
    return ordered.map((prefix) => ({
      prefix,
      name: collections?.[prefix]?.name ?? prefix,
      count: prefixCounts[prefix],
    }));
  }, [prefixCounts, filters.prefixes, collections]);

  const visibleSets = showAllSets ? setOptions : setOptions.slice(0, 10);

  const togglePrefix = (prefix: string) => {
    const has = filters.prefixes.includes(prefix);
    onChange({ ...filters, prefixes: has ? filters.prefixes.filter((p) => p !== prefix) : [...filters.prefixes, prefix] });
  };

  return (
    <div className="text-sm">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-base font-semibold">Filters</h2>
        {isFiltered(filters) && (
          <button
            type="button"
            onClick={() => onChange({ color: null, style: null, prefixes: [], sort: 'popular' })}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary-soft"
          >
            <RotateCcw size={12} aria-hidden="true" /> Reset
          </button>
        )}
      </div>

      <Section title="Colors">
        <div className="flex flex-wrap gap-2">
          {COLOR_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              active={filters.color === option.value}
              title={option.hint}
              onClick={() => onChange({ ...filters, color: filters.color === option.value ? null : option.value })}
            >
              <span className={`h-3.5 w-3.5 rounded-full ${option.swatch}`} aria-hidden="true" />
              {option.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Style">
        <div className="flex flex-wrap gap-2">
          {STYLE_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              active={filters.style === option.value}
              title={option.hint}
              onClick={() => onChange({ ...filters, style: filters.style === option.value ? null : option.value })}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Collections">
        <ul className="space-y-0.5">
          {visibleSets.map((set) => {
            const checked = filters.prefixes.includes(set.prefix);
            return (
              <li key={set.prefix}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-2">
                  <input type="checkbox" className="peer sr-only" checked={checked} onChange={() => togglePrefix(set.prefix)} />
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring)] ${
                      checked ? 'border-primary bg-primary text-primary-contrast' : 'border-border-strong'
                    }`}
                    aria-hidden="true"
                  >
                    {checked && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className="flex-1 truncate">{set.name}</span>
                  {set.count !== undefined && <span className="text-xs tabular-nums text-muted">{set.count}</span>}
                </label>
              </li>
            );
          })}
        </ul>
        {setOptions.length > 10 && (
          <button
            type="button"
            onClick={() => setShowAllSets((s) => !s)}
            className="mt-2 px-2 text-xs font-medium text-primary hover:underline"
          >
            {showAllSets ? 'Show fewer' : `Show ${setOptions.length - 10} more`}
          </button>
        )}
      </Section>

      <Section title="Sort">
        <div className="flex flex-wrap gap-2">
          {SORT_OPTIONS.map((option) => (
            <Chip key={option.value} active={filters.sort === option.value} title={option.hint} onClick={() => onChange({ ...filters, sort: option.value })}>
              {option.label}
            </Chip>
          ))}
        </div>
        {filters.sort === 'recent' && <p className="mt-2 text-xs text-muted">Icons from the most recently updated sets appear first.</p>}
      </Section>
    </div>
  );
}
