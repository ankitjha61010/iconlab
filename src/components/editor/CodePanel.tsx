import { useId, useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useToast } from '../common/Toast';
import { copyToClipboard } from '../../utils/downloadUtils';
import { buildSnippets, type SnippetKind } from '../../utils/codeSnippets';
import type { IconCustomization } from '../../types/icon';
import type { ColorMode } from '../../utils/svgUtils';

interface CodePanelProps {
  iconName: string;
  custom: IconCustomization;
  svg: string;
  colorMode: ColorMode;
}

export function CodePanel({ iconName, custom, svg, colorMode }: CodePanelProps) {
  const [tab, setTab] = useState<SnippetKind>('svg');
  const [copied, setCopied] = useState<SnippetKind | null>(null);
  const notify = useToast();
  const id = useId();
  const snippets = useMemo(() => buildSnippets({ iconName, custom, svg, colorMode }), [iconName, custom, svg, colorMode]);
  const current = snippets.find((s) => s.kind === tab) ?? snippets[0];

  const copy = async () => {
    const ok = await copyToClipboard(current.code);
    if (ok) {
      setCopied(current.kind);
      setTimeout(() => setCopied(null), 1600);
      notify(`${current.label} code copied`);
    } else {
      notify('Couldn’t access the clipboard', 'error');
    }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <h2 id={`${id}-title`} className="text-base font-semibold">
          Use in code
        </h2>
        <div role="tablist" aria-label="Code format" className="flex gap-1 overflow-x-auto rounded-lg bg-surface-2 p-1">
          {snippets.map((snippet) => (
            <button
              key={snippet.kind}
              role="tab"
              type="button"
              id={`${id}-tab-${snippet.kind}`}
              aria-selected={tab === snippet.kind}
              aria-controls={`${id}-panel`}
              onClick={() => setTab(snippet.kind)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                tab === snippet.kind ? 'bg-surface text-text shadow-soft' : 'text-muted hover:text-text'
              }`}
            >
              {snippet.label}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${current.kind}`} className="p-4 sm:p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <p className="text-xs text-muted">{current.note}</p>
          <button
            type="button"
            onClick={copy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-contrast hover:bg-primary-hover"
          >
            {copied === current.kind ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            {copied === current.kind ? 'Copied' : `Copy ${current.label}`}
          </button>
        </div>
        <pre className="max-h-80 overflow-auto rounded-xl bg-[#0f1020] p-4 text-[12.5px] leading-relaxed text-[#d6d8f0]">
          <code>{current.code}</code>
        </pre>
      </div>
    </section>
  );
}
