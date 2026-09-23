import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Copy, Download, ExternalLink, FileQuestion, Scale, SlidersHorizontal } from 'lucide-react';
import { IconEditor, DEFAULT_CUSTOMIZATION } from '../components/editor/IconEditor';
import { exportIcon } from '../components/editor/DownloadPanel';
import { FavoriteButton } from '../components/icons/FavoriteButton';
import { RelatedIcons } from '../components/icons/RelatedIcons';
import { Button, ButtonLink } from '../components/common/Button';
import { StateMessage } from '../components/common/StateMessage';
import { useToast } from '../components/common/Toast';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { useRecentIcons } from '../hooks/useRecentIcons';
import { useCollections } from '../hooks/useCollections';
import {
  IconifyError,
  getCollectionInfo,
  getFriendlyErrorMessage,
  getIcon,
  humanizeIconName,
  isAbortError,
  toIconName,
} from '../services/iconifyService';
import { buildCustomSvg } from '../utils/svgUtils';
import { copyToClipboard } from '../utils/downloadUtils';
import type { CollectionInfo, IconCustomization, IconData } from '../types/icon';

type Status = 'loading' | 'ready' | 'not-found' | 'error';

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words">{children}</dd>
    </div>
  );
}

function IconInfo({ iconName, icon, info }: { iconName: string; icon: IconData; info: CollectionInfo | null }) {
  const notify = useToast();
  return (
    <section className="rounded-2xl border border-border bg-surface p-5" aria-labelledby="icon-info-heading">
      <h2 id="icon-info-heading" className="text-base font-semibold">
        Icon details
      </h2>
      <dl className="mt-2 divide-y divide-border">
        <DetailRow label="Name">{humanizeIconName(icon.name)}</DetailRow>
        <DetailRow label="Collection">
          <Link to={`/collections/${icon.prefix}`} className="text-primary hover:underline">
            {info?.name ?? icon.prefix}
          </Link>
        </DetailRow>
        <DetailRow label="Provider">
          {info?.author?.url ? (
            <a href={info.author.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
              {info.author.name} <ExternalLink size={12} aria-hidden="true" />
            </a>
          ) : (
            (info?.author?.name ?? 'Unknown')
          )}
        </DetailRow>
        <DetailRow label="License">{info?.license?.title ?? 'Not specified'}</DetailRow>
        <DetailRow label="Iconify ID">
          <button
            type="button"
            onClick={async () => notify((await copyToClipboard(iconName)) ? 'Identifier copied' : 'Couldn’t access the clipboard')}
            className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-0.5 font-mono text-xs hover:bg-border"
            aria-label={`Copy identifier ${iconName}`}
          >
            {iconName} <Copy size={12} aria-hidden="true" />
          </button>
        </DetailRow>
        <DetailRow label="Original size">
          {icon.width} × {icon.height}
        </DetailRow>
        {info?.total !== undefined && <DetailRow label="Icons in set">{info.total.toLocaleString()}</DetailRow>}
      </dl>

      <div className="mt-4 rounded-xl bg-surface-2 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Scale size={15} aria-hidden="true" /> Icon source &amp; license
        </h3>
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          This icon is part of {info?.name ?? 'an open-source icon set'}
          {info?.author?.name ? ` by ${info.author.name}` : ''}
          {info?.license?.title ? `, published under the ${info.license.title} license` : ''}. License terms are set by the icon set’s
          author and may require attribution — review them before using the icon, especially commercially.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold">
          {info?.license?.url && (
            <a href={info.license.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              View license <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
          {info?.author?.url && (
            <a href={info.author.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              Icon source <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

export default function IconDetails() {
  const { collection = '', icon: iconParam = '' } = useParams();
  const location = useLocation();
  const iconName = toIconName(collection, iconParam);
  const title = humanizeIconName(iconParam);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<unknown>(null);
  const [icon, setIcon] = useState<IconData | null>(null);
  const [info, setInfo] = useState<CollectionInfo | null>(null);
  const [custom, setCustom] = useState<IconCustomization>(DEFAULT_CUSTOMIZATION);
  const [attempt, setAttempt] = useState(0);
  const { addRecent } = useRecentIcons();
  const { collections } = useCollections();
  const notify = useToast();

  useDocumentMeta(
    status === 'not-found' ? 'Icon not found' : `${title} Icon`,
    `${title} icon${info ? ` from ${info.name}` : ''}. Customize color, size, rotation and background, then download SVG, PNG or JPG or copy code.`,
  );

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    setIcon(null);
    setCustom(DEFAULT_CUSTOMIZATION);
    window.scrollTo({ top: 0 });

    Promise.all([getIcon(collection, iconParam, controller.signal), getCollectionInfo(collection).catch(() => null)])
      .then(([data, collectionInfo]) => {
        if (controller.signal.aborted) return;
        setIcon(data);
        setInfo(collectionInfo);
        setStatus('ready');
        addRecent(toIconName(collection, iconParam));
      })
      .catch((e) => {
        if (isAbortError(e) || controller.signal.aborted) return;
        setError(e);
        setStatus(e instanceof IconifyError && e.kind === 'not_found' ? 'not-found' : 'error');
      });
    return () => controller.abort();
  }, [collection, iconParam, attempt, addRecent]);

  // "Customize" quick action from icon cards jumps straight to the controls.
  useEffect(() => {
    if (status === 'ready' && (location.state as { focusEditor?: boolean } | null)?.focusEditor && window.innerWidth < 1024) {
      document.getElementById('customize')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [status, location.state]);

  const svg = useMemo(() => (icon ? buildCustomSvg(icon, custom) : ''), [icon, custom]);
  const relatedQuery = iconParam.split('-').find((w) => w.length > 2 && !/^\d+$/.test(w)) ?? iconParam.split('-')[0];

  if (status === 'not-found') {
    return (
      <StateMessage
        icon={<FileQuestion size={26} />}
        title="Icon not found"
        description={`We couldn’t find “${iconName}”. It may have been renamed or removed from its collection.`}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <ButtonLink to={`/icons?q=${encodeURIComponent(relatedQuery || 'icon')}`}>Search similar icons</ButtonLink>
            <ButtonLink to="/" variant="outline">
              Go home
            </ButtonLink>
          </div>
        }
      />
    );
  }

  if (status === 'error') {
    return (
      <StateMessage
        tone="danger"
        icon={<AlertTriangle size={26} />}
        title="Couldn’t load this icon"
        description={getFriendlyErrorMessage(error)}
        action={<Button onClick={() => setAttempt((a) => a + 1)}>Try again</Button>}
      />
    );
  }

  const copySvg = async () => notify((await copyToClipboard(svg)) ? 'SVG code copied' : 'Couldn’t access the clipboard', 'success');
  const downloadSvg = async () => {
    try {
      await exportIcon('svg', { iconName, size: custom.size, getSvg: () => svg, transparent: custom.transparent, background: custom.background });
      notify('SVG downloaded');
    } catch {
      notify('Export failed. Please try again.', 'error');
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link to="/" className="hover:text-text">
              Home
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight size={14} />
          </li>
          <li>
            <Link to="/collections" className="hover:text-text">
              Collections
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight size={14} />
          </li>
          <li>
            <Link to={`/collections/${collection}`} className="hover:text-text">
              {info?.name ?? collection}
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight size={14} />
          </li>
          <li aria-current="page" className="font-medium text-text">
            {title}
          </li>
        </ol>
      </nav>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          <p className="mt-1 text-sm text-muted">
            {info?.name ?? collection} · <span className="font-mono">{iconName}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            icon={<SlidersHorizontal size={16} aria-hidden="true" />}
            className="lg:hidden"
            onClick={() => document.getElementById('customize')?.scrollIntoView({ behavior: 'smooth' })}
          >
            Customize
          </Button>
          <Button variant="outline" icon={<Copy size={16} aria-hidden="true" />} onClick={copySvg} disabled={!icon}>
            Copy SVG
          </Button>
          <Button icon={<Download size={16} aria-hidden="true" />} onClick={downloadSvg} disabled={!icon}>
            Download SVG
          </Button>
          <FavoriteButton name={iconName} variant="button" />
        </div>
      </div>

      {status === 'loading' || !icon ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]" role="status" aria-label="Loading icon">
          <div className="skeleton h-[480px] rounded-2xl" />
          <div className="skeleton h-[480px] rounded-2xl" />
        </div>
      ) : (
        <>
          <IconEditor icon={icon} iconName={iconName} title={title} custom={custom} onChange={setCustom} />
          <div className="mt-6 lg:max-w-[calc(100%-384px)]">
            <IconInfo iconName={iconName} icon={icon} info={info} />
          </div>
          <RelatedIcons
            title={`More from ${info?.name ?? collection}`}
            query={relatedQuery}
            prefixes={[collection]}
            exclude={iconName}
            collections={collections}
          />
          <RelatedIcons title={`Similar “${relatedQuery}” icons`} query={relatedQuery} exclude={iconName} collections={collections} />
        </>
      )}
    </div>
  );
}
