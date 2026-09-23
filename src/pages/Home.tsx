import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Download, History, Search, SlidersHorizontal, X } from 'lucide-react';
import { IconSearch } from '../components/icons/IconSearch';
import { CategoryCard } from '../components/icons/CategoryCard';
import { CollectionCard } from '../components/icons/CollectionCard';
import { IconPreview } from '../components/icons/IconPreview';
import { useCollections } from '../hooks/useCollections';
import { useRecentIcons } from '../hooks/useRecentIcons';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { humanizeIconName } from '../services/iconifyService';
import { CATEGORIES, HOME_COLLECTIONS, POPULAR_SEARCHES } from '../constants';

function SectionHeading({ id, title, subtitle, action }: { id: string; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id={id} className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function RecentlyViewed() {
  const { recent, clearRecent } = useRecentIcons();
  if (!recent.length) return null;
  return (
    <section className="mx-auto max-w-7xl px-4 pt-12 sm:px-6 lg:px-8" aria-labelledby="recent-heading">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="recent-heading" className="flex items-center gap-2 text-base font-semibold">
          <History size={18} className="text-muted" aria-hidden="true" /> Recently viewed
        </h2>
        <button type="button" onClick={clearRecent} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-text">
          <X size={12} aria-hidden="true" /> Clear
        </button>
      </div>
      <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
        {recent.map(({ name }) => {
          const [prefix, icon] = name.split(':');
          return (
            <li key={name} className="shrink-0">
              <Link
                to={`/icon/${prefix}/${icon}`}
                title={`${humanizeIconName(icon)} · ${prefix}`}
                className="flex h-20 w-20 flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-surface text-text transition-colors hover:border-border-strong hover:bg-surface-2"
              >
                <IconPreview name={name} className="h-7 w-7" label={humanizeIconName(icon)} />
                <span className="w-full truncate px-1.5 text-center text-[10px] text-muted">{icon}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function Home() {
  useDocumentMeta(null);
  const { collections } = useCollections();

  const stats = useMemo(() => {
    if (!collections) return null;
    const list = Object.values(collections);
    return { icons: list.reduce((sum, c) => sum + (c.total ?? 0), 0), sets: list.length };
  }, [collections]);

  const featured = useMemo(
    () => (collections ? HOME_COLLECTIONS.map((p) => collections[p]).filter(Boolean) : []),
    [collections],
  );

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-header text-header-text">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          aria-hidden="true"
          style={{
            backgroundImage:
              'radial-gradient(600px 300px at 15% 0%, rgb(109 93 252 / 0.35), transparent 70%), radial-gradient(500px 280px at 90% 20%, rgb(47 179 255 / 0.25), transparent 70%)',
          }}
        />
        <div className="relative mx-auto max-w-4xl px-4 pb-20 pt-14 text-center sm:px-6 sm:pt-20 lg:pb-24">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-header-muted">
            Discover. Customize. Download.
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-5xl">
            Millions of icons, one <span className="bg-gradient-to-r from-[#a79dff] to-[#6fd0ff] bg-clip-text text-transparent">creative workspace.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-header-muted sm:text-lg">Search, customize and download icons for your next project.</p>

          <IconSearch variant="hero" className="mx-auto mt-8 max-w-2xl text-left" />

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-sm">
            <span className="text-header-muted">Popular searches:</span>
            {POPULAR_SEARCHES.map((term) => (
              <Link
                key={term}
                to={`/icons?q=${encodeURIComponent(term)}`}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 capitalize text-header-text transition-colors hover:border-white/25 hover:bg-white/10"
              >
                {term}
              </Link>
            ))}
          </div>

          <dl className="mx-auto mt-10 flex max-w-lg justify-center gap-10 text-center">
            <div>
              <dt className="text-xs text-header-muted">Icons</dt>
              <dd className="text-xl font-bold tabular-nums">{stats ? `${Math.floor(stats.icons / 1000).toLocaleString()}k+` : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-header-muted">Icon sets</dt>
              <dd className="text-xl font-bold tabular-nums">{stats ? stats.sets : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-header-muted">Formats</dt>
              <dd className="text-xl font-bold">SVG · PNG · JPG</dd>
            </div>
          </dl>
        </div>
      </section>

      <RecentlyViewed />

      <section className="mx-auto max-w-7xl px-4 pt-14 sm:px-6 lg:px-8" aria-labelledby="categories-heading">
        <SectionHeading id="categories-heading" title="Popular categories" subtitle="Jump into a topic — every tile is a live search." />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-6">
          {CATEGORIES.map((category) => (
            <CategoryCard key={category.label} label={category.label} query={category.query} />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6 lg:px-8" aria-labelledby="collections-heading">
        <SectionHeading
          id="collections-heading"
          title="Featured collections"
          subtitle="Complete, consistent icon sets from open-source designers."
          action={
            <Link to="/collections" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
              All collections <ArrowRight size={15} aria-hidden="true" />
            </Link>
          }
        />
        <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-4">
          {featured.length
            ? featured.map((c) => <CollectionCard key={c.prefix} collection={c} />)
            : Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-44 rounded-2xl" aria-hidden="true" />)}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6 lg:px-8" aria-labelledby="how-heading">
        <h2 id="how-heading" className="sr-only">How IconLab works</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {[
            { icon: Search, title: 'Discover', text: 'Search more than 200,000 open-source icons and filter by style, color and collection.' },
            { icon: SlidersHorizontal, title: 'Customize', text: 'Change colors, size, rotation, flip and background — with a live preview.' },
            { icon: Download, title: 'Download', text: 'Export SVG, PNG or JPG, or copy ready-to-paste HTML, React and React Native code.' },
          ].map((step, index) => (
            <li key={step.title} className="rounded-2xl border border-border bg-surface p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary" aria-hidden="true">
                  <step.icon size={20} />
                </span>
                <span className="text-xs font-semibold text-muted">STEP {index + 1}</span>
              </div>
              <h3 className="mt-4 font-semibold">{step.title}</h3>
              <p className="mt-1 text-sm text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
