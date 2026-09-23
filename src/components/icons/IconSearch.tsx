import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Clock, Loader2, Search, Sparkles, TrendingUp, X } from 'lucide-react';
import { Dropdown } from '../common/Dropdown';
import { useDebounce } from '../../hooks/useDebounce';
import { useRecentSearches } from '../../hooks/useRecentSearches';
import { getSearchSuggestions, isAbortError } from '../../services/iconifyService';
import { POPULAR_SEARCHES } from '../../constants';

type SearchMode = 'icons' | 'collections';

interface IconSearchProps {
  variant?: 'hero' | 'compact';
  defaultQuery?: string;
  autoFocus?: boolean;
  className?: string;
  onSubmitted?: () => void;
}

interface Item {
  kind: 'recent' | 'suggestion' | 'popular';
  value: string;
}

const SUGGESTION_DEBOUNCE = 250;

export function IconSearch({ variant = 'compact', defaultQuery = '', autoFocus, className = '', onSubmitted }: IconSearchProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [value, setValue] = useState(defaultQuery);
  const [mode, setMode] = useState<SearchMode>('icons');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const { searches, addSearch, removeSearch } = useRecentSearches();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const debounced = useDebounce(value, SUGGESTION_DEBOUNCE);
  const hero = variant === 'hero';

  useEffect(() => {
    setValue(defaultQuery);
  }, [defaultQuery]);

  // Live keyword suggestions, cancelled when the input changes again.
  useEffect(() => {
    const q = debounced.trim();
    if (mode !== 'icons' || q.length < 2 || !open) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }
    const controller = new AbortController();
    setLoadingSuggestions(true);
    getSearchSuggestions(q, controller.signal)
      .then((list) => !controller.signal.aborted && setSuggestions(list))
      .catch((error) => {
        if (!isAbortError(error)) setSuggestions([]);
      })
      .finally(() => !controller.signal.aborted && setLoadingSuggestions(false));
    return () => controller.abort();
  }, [debounced, mode, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const q = value.trim().toLowerCase();
    if (mode !== 'icons') return [];
    if (!q) {
      return [
        ...searches.slice(0, 5).map((s) => ({ kind: 'recent' as const, value: s })),
        ...POPULAR_SEARCHES.filter((p) => !searches.slice(0, 5).includes(p))
          .slice(0, 5)
          .map((p) => ({ kind: 'popular' as const, value: p })),
      ];
    }
    const recent = searches.filter((s) => s.startsWith(q) && s !== q).slice(0, 3);
    return [
      ...recent.map((s) => ({ kind: 'recent' as const, value: s })),
      ...suggestions.filter((s) => !recent.includes(s)).map((s) => ({ kind: 'suggestion' as const, value: s })),
    ];
  }, [value, searches, suggestions, mode]);

  useEffect(() => {
    setActive(-1);
  }, [items]);

  const submit = (query: string) => {
    const q = query.trim();
    setOpen(false);
    inputRef.current?.blur();
    onSubmitted?.();
    if (mode === 'collections') {
      navigate(q ? `/collections?q=${encodeURIComponent(q)}` : '/collections');
      return;
    }
    if (!q) {
      inputRef.current?.focus();
      return;
    }
    addSearch(q);
    // Keep active filters when searching again from the results page.
    const params = location.pathname === '/icons' ? new URLSearchParams(location.search) : new URLSearchParams();
    params.set('q', q);
    setValue(q);
    navigate(`/icons?${params.toString()}`);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(active >= 0 && items[active] ? items[active].value : value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (items.length ? (i + 1) % items.length : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (items.length ? (i <= 0 ? items.length - 1 : i - 1) : -1));
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  };

  const showPanel = open && mode === 'icons' && (items.length > 0 || loadingSuggestions);
  const height = hero ? 'h-14' : 'h-10';

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <form
        role="search"
        onSubmit={onSubmit}
        className={`flex items-stretch overflow-visible rounded-xl border bg-surface text-text transition-shadow ${
          hero ? 'border-transparent shadow-lift' : 'border-border'
        } focus-within:ring-2 focus-within:ring-[var(--ring)]`}
      >
        {hero && (
          <Dropdown<SearchMode>
            label="Search type"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'icons', label: 'Icons', description: 'Search across 200,000+ icons' },
              { value: 'collections', label: 'Collections', description: 'Find an icon set by name' },
            ]}
            className="shrink-0 border-r border-border"
            buttonClassName="rounded-l-xl px-4 text-text hover:bg-surface-2"
          />
        )}
        <label className="flex min-w-0 flex-1 items-center gap-2 px-3">
          <Search size={hero ? 20 : 17} className="shrink-0 text-muted" aria-hidden="true" />
          <span className="sr-only">{mode === 'icons' ? 'Search icons' : 'Search collections'}</span>
          <input
            ref={inputRef}
            type="search"
            value={value}
            autoFocus={autoFocus}
            autoComplete="off"
            spellCheck={false}
            placeholder={mode === 'icons' ? 'Search icons…' : 'Search collections…'}
            onChange={(e) => {
              setValue(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={showPanel}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            className={`${height} w-full min-w-0 bg-transparent outline-none placeholder:text-muted focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden ${
              hero ? 'text-base' : 'text-sm'
            }`}
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                setValue('');
                inputRef.current?.focus();
              }}
              className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-text"
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </label>
        <button
          type="submit"
          className={`m-1 inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary font-semibold text-primary-contrast hover:bg-primary-hover ${
            hero ? 'px-6 text-base' : 'px-3 text-sm'
          }`}
          aria-label="Search"
        >
          {hero ? 'Search' : <Search size={16} aria-hidden="true" />}
        </button>
      </form>

      {showPanel && (
        <div className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-border bg-surface p-1.5 text-text shadow-lift">
          <ul id={listId} role="listbox" aria-label="Search suggestions">
            {items.map((item, index) => (
              <li
                key={`${item.kind}-${item.value}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => submit(item.value)}
                onMouseEnter={() => setActive(index)}
                className={`group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${index === active ? 'bg-surface-2' : ''}`}
              >
                {item.kind === 'recent' && <Clock size={15} className="text-muted" aria-hidden="true" />}
                {item.kind === 'popular' && <TrendingUp size={15} className="text-muted" aria-hidden="true" />}
                {item.kind === 'suggestion' && <Sparkles size={15} className="text-primary" aria-hidden="true" />}
                <span className="flex-1 truncate">{item.value}</span>
                <span className="text-xs text-muted">
                  {item.kind === 'recent' ? 'Recent' : item.kind === 'popular' ? 'Popular' : ''}
                </span>
                {item.kind === 'recent' && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSearch(item.value);
                    }}
                    className="rounded p-0.5 text-muted opacity-0 hover:text-text group-hover:opacity-100 focus:opacity-100"
                    aria-label={`Remove ${item.value} from recent searches`}
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {loadingSuggestions && !items.length && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted">
              <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Finding suggestions…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
