import { useRef, useState, type DragEvent } from 'react';
import { ImagePlus, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '../common/Button';

interface ImageDropzoneProps {
  onFile: (file: File) => void;
  onSample: () => void;
  busy?: boolean;
  error?: string | null;
}

export function ImageDropzone({ onFile, onSample, busy, error }: ImageDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`flex min-h-[420px] flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
        dragging ? 'border-primary bg-primary-soft' : 'border-border-strong bg-surface'
      }`}
    >
      <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-soft text-primary" aria-hidden="true">
        {busy ? <Loader2 size={30} className="animate-spin" /> : <ImagePlus size={30} />}
      </span>
      <h2 className="text-lg font-semibold">Upload an image</h2>
      <p className="mt-1 max-w-sm text-sm text-muted">Drag & drop, paste (Ctrl/⌘ + V), or browse. PNG, JPG, WebP, GIF or SVG up to 25 MB.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button onClick={() => inputRef.current?.click()} disabled={busy} icon={<ImagePlus size={16} aria-hidden="true" />}>
          Choose image
        </Button>
        <Button variant="outline" onClick={onSample} disabled={busy} icon={<Sparkles size={16} aria-hidden="true" />}>
          Try a sample
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="Upload image"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
      {error && (
        <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <p className="mt-6 flex items-center gap-1.5 text-xs text-muted">
        <ShieldCheck size={14} aria-hidden="true" /> Your image never leaves your device. All processing runs in the browser.
      </p>
    </div>
  );
}
