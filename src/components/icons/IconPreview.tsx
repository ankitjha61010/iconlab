import { memo, useMemo } from 'react';
import { ImageOff } from 'lucide-react';
import { useInView } from '../../hooks/useInView';
import { useIconData } from '../../hooks/useIconData';
import { iconToSvg } from '../../utils/svgUtils';
import type { IconName } from '../../types/icon';

interface IconPreviewProps {
  name: IconName;
  /** Tailwind size classes, e.g. "h-10 w-10". */
  className?: string;
  label?: string;
}

/** Renders an Iconify icon as inline SVG, fetching it only once it nears the viewport. */
export const IconPreview = memo(function IconPreview({ name, className = 'h-10 w-10', label }: IconPreviewProps) {
  const { ref, inView } = useInView<HTMLSpanElement>('300px');
  const data = useIconData(name, inView);
  const svg = useMemo(() => (data ? iconToSvg(data) : ''), [data]);

  return (
    <span
      ref={ref}
      role="img"
      aria-label={label ?? name}
      className={`icon-svg inline-flex shrink-0 items-center justify-center ${className}`}
    >
      {data === undefined && <span className="skeleton h-full w-full rounded-md" aria-hidden="true" />}
      {data === null && <ImageOff className="h-1/2 w-1/2 text-muted" aria-hidden="true" />}
      {data && <span className="h-full w-full" dangerouslySetInnerHTML={{ __html: svg }} />}
    </span>
  );
});
