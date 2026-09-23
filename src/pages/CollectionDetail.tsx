import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, ExternalLink, FileQuestion, Search } from 'lucide-react';
import { IconGrid } from '../components/icons/IconGrid';
import { IconGridSkeleton } from '../components/icons/IconSkeleton';
import { Input } from '../components/common/Input';
import { Button, ButtonLink } from '../components/common/Button';
import { StateMessage } from '../components/common/StateMessage';
import { useDebounce } from '../hooks/useDebounce';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { IconifyError, getCollectionIcons, getFriendlyErrorMessage, isAbortError } from '../services/iconifyService';
import type { CollectionIcons } from '../types/icon';

const PAGE = 96;

export default function CollectionDetail() {
  const { prefix = '' } = useParams();
  const [data, setData] = useState<CollectionIcons | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [text, setText] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE);
  const filter = useDebounce(text, 200).trim().toLowerCase();

  useDocumentMeta(
    data ? `${data.title} Icons` : 'Collection',
    data ? `${data.total.toLocaleString()} ${data.title} icons${data.info?.license ? ` (${data.info.license.title})` : ''}. Customize and download in SVG, PNG or JPG.` : undefined,
  );

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(null);
    setCategory(null);
    setText('');
    getCollectionIcons(prefix, controller.signal)
      .then((result) => !controller.signal.aborted && setData(result))
      .catch((e) => !isAbortError(e) && !controller.signal.aborted && setError(e));
    return () => controller.abort();
  }, [prefix, attempt]);

  useEffect(() => {
    setVisible(PAGE);
  }, [filter, category]);

  const names = useMemo(() => {
    if (!data) return [];
    const source = category ? data.categories[category] ?? [] : data.icons;
    const list = filter ? source.filter((n) => n.includes(filter.replace(/\s+/g, '-'))) : source;
    return list.map((n) => `${prefix}:${n}`);
  }, [data, category, filter, prefix]);

  const collectionsMap = useMemo(
    () => (data?.info ? { [prefix]: data.info } : { [prefix]: { prefix, name: data?.title ?? prefix } }),
    [data, prefix],
  );

  if (error) {
    const missing = error instanceof IconifyError && error.kind === 'not_found';
    return (
      <StateMessage
        tone={missing ? 'neutral' : 'danger'}
        icon={missing ? <FileQuestion size={26} /> : <AlertTriangle size={26} />}
        title={missing ? 'Collection not found' : 'Couldn’t load this collection'}
        description={missing ? `There’s no icon set called “${prefix}”.` : getFriendlyErrorMessage(error)}
        action={missing ? <ButtonLink to="/collections">Browse collections</ButtonLink> : <Button onClick={() => setAttempt((a) => a + 1)}>Try again</Button>}
      />
    );
  }

  const info = data?.info;
  const categoryNames = data ? Object.keys(data.categories) : [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Link to="/collections" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronLeft size={16} aria-hidden="true" /> All collections
      </Link>

      <header className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        {data ? (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{data.title}</h1>
              <p className="mt-1 text-sm text-muted">
                {data.total.toLocaleString()} icons
                {info?.author?.name && (
                  <>
                    {' '}
                    · by{' '}
                    {info.author.url ? (
                      <a href={info.author.url} target="_blank" rel="noreferrer" className="font-medium text-text hover:underline">
                        {info.author.name}
                      </a>
                    ) : (
                      info.author.name
                    )}
                  </>
                )}
                {info?.category ? ` · ${info.category}` : ''}
              </p>
            </div>
            {info?.license && (
              <div className="rounded-xl bg-surface-2 px-4 py-3 text-sm">
                <div className="text-xs text-muted">License</div>
                <div className="font-semibold">{info.license.title}</div>
                {info.license.url && (
                  <a href={info.license.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                    View license <ExternalLink size={11} aria-hidden="true" />
                  </a>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2" aria-hidden="true">
            <div className="skeleton h-8 w-64 rounded-lg" />
            <div className="skeleton h-4 w-40 rounded" />
          </div>
        )}
      </header>

      <div className="mt-6 flex flex-col gap-3">
        <Input
          wrapperClassName="sm:max-w-md"
          leading={<Search size={16} />}
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Search in ${data?.title ?? 'this collection'}…`}
          aria-label="Search icons in this collection"
        />
        {categoryNames.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Categories">
            {[null, ...categoryNames].map((name) => (
              <button
                key={name ?? 'all'}
                type="button"
                onClick={() => setCategory(name)}
                aria-pressed={category === name}
                className={`shrink-0 rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                  category === name ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface hover:bg-surface-2'
                }`}
              >
                {name ?? 'All'}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6">
        {!data ? (
          <IconGridSkeleton count={24} />
        ) : names.length === 0 ? (
          <StateMessage icon={<Search size={26} />} title="No icons match" description={`Nothing in ${data.title} matches “${text}”.`} />
        ) : (
          <>
            <p className="mb-4 text-sm text-muted">{names.length.toLocaleString()} icons</p>
            <IconGrid
              icons={names.slice(0, visible)}
              collections={collectionsMap}
              hasMore={visible < names.length}
              onLoadMore={() => setVisible((v) => v + PAGE)}
              label={`${data.title} icons`}
            />
          </>
        )}
      </div>
    </div>
  );
}
