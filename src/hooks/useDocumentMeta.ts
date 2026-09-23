import { useEffect } from 'react';

const SITE = 'IconLab';
const DEFAULT_DESCRIPTION =
  'Search millions of open-source icons, customize color, size, rotation and background, then download SVG, PNG or JPEG right in your browser.';

function setMeta(selector: string, attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/** Sets the page title plus description / Open Graph / Twitter tags. */
export function useDocumentMeta(title: string | null, description: string = DEFAULT_DESCRIPTION) {
  useEffect(() => {
    const full = title ? `${title} - ${SITE}` : `${SITE} – Discover. Customize. Download.`;
    document.title = full;
    setMeta('meta[name="description"]', 'name', 'description', description);
    setMeta('meta[property="og:title"]', 'property', 'og:title', full);
    setMeta('meta[property="og:description"]', 'property', 'og:description', description);
    setMeta('meta[property="og:url"]', 'property', 'og:url', window.location.href);
    setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', full);
    setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description);
  }, [title, description]);
}
