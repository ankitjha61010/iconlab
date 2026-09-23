import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Search, SearchX } from 'lucide-react';
import { CollectionCard } from '../components/icons/CollectionCard';
import { Input } from '../components/common/Input';
import { Button } from '../components/common/Button';
import { Dropdown } from '../components/common/Dropdown';
import { StateMessage } from '../components/common/StateMessage';
import { useCollections } from '../hooks/useCollections';
import { useDebounce } from '../hooks/useDebounce';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { getFriendlyErrorMessage } from '../services/iconifyService';

const PAGE = 36;
type Sort = 'popular' | 'name' | 'size';
const ARCHIVE = 'Archive / Unmaintained';

export default function Collections() {
  useDocumentMeta('Icon Collections', 'Browse 200+ open-source icon sets — Material Design, Tabler, Phosphor, Font Awesome and more.');
  const [params, setParams] = useSearchParams();
  const { collections, error, loading, retry } = useCollections();
  const urlQuery = params.get('q') ?? '';
  const [text, setText] = useState(urlQuery);
  useEffect(() => {
    setText(urlQuery);
  }, [urlQuery]);
  const query = useDebounce(text, 200).trim().toLowerCase();
  const category = params.get('category') ?? 'all';
  const [sort, setSort] = useState<Sort>('popular');
  const [visible, setVisible] = useState(PAGE);

  const all = useMemo(() => (collections ? Object.values(collections) : []), [collections]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of all) if (c.category) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => (a[0] === ARCHIVE ? 1 : b[0] === ARCHIVE ? -1 : b[1] - a[1]));
  }, [all]);

  const filtered = useMemo(() => {
    let list = all.filter((c) => {
      if (category === 'all' ? c.category === ARCHIVE : c.category !== category) return false;
      if (!query) return true;
      return `${c.name} ${c.prefix} ${c.author?.name ?? ''} ${c.license?.title ?? ''}`.toLowerCase().includes(query);
    });
    if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'size') list = [...list].sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
    return list;
  }, [all, category, query, sort]);

  const setCategory = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'all') next.delete('category');
    else next.set('category', value);
    setParams(next, { replace: true });
    setVisible(PAGE);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Collections</h1>
      <p className="mt-1 text-muted">
        {collections ? `${all.length} open-source icon sets` : 'Open-source icon sets'}, each with its own style and license.
      </p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          wrapperClassName="flex-1 sm:max-w-md"
          leading={<Search size={16} />}
          type="search"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setVisible(PAGE);
          }}
          placeholder="Search collections by name, author or license…"
          aria-label="Search collections"
        />
        <div className="flex h-10 items-center rounded-lg border border-border bg-surface px-3 sm:ml-auto">
          <span className="mr-2 text-sm text-muted">Sort:</span>
          <Dropdown<Sort>
            label="Sort collections"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'popular', label: 'Featured' },
              { value: 'size', label: 'Most icons' },
              { value: 'name', label: 'Name A–Z' },
            ]}
          />
        </div>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-2" role="group" aria-label="Collection categories">
        {[['all', all.filter((c) => c.category !== ARCHIVE).length] as const, ...categories].map(([name, count]) => (
          <button
            key={name}
            type="button"
            onClick={() => setCategory(name)}
            aria-pressed={category === name}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              category === name ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface hover:bg-surface-2'
            }`}
          >
            {name === 'all' ? 'All' : name} <span className="text-xs opacity-70">{count}</span>
          </button>
        ))}
      </div>

      {loading && (
        <div className="mt-6 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" role="status" aria-label="Loading collections">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="skeleton h-44 rounded-2xl" />
          ))}
        </div>
      )}

      {!!error && (
        <StateMessage
          tone="danger"
          icon={<AlertTriangle size={26} />}
          title="Couldn’t load collections"
          description={getFriendlyErrorMessage(error)}
          action={<Button onClick={retry}>Try again</Button>}
        />
      )}

      {collections && filtered.length === 0 && (
        <StateMessage icon={<SearchX size={26} />} title="No collections match" description="Try a different name or category." />
      )}

      {collections && filtered.length > 0 && (
        <>
          <ul className="mt-6 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.slice(0, visible).map((c) => (
              <li key={c.prefix}>
                <CollectionCard collection={c} />
              </li>
            ))}
          </ul>
          {visible < filtered.length && (
            <div className="mt-8 flex justify-center">
              <Button variant="outline" onClick={() => setVisible((v) => v + PAGE)}>
                Show more collections ({filtered.length - visible} left)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
