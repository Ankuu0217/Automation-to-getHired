/**
 * Step 1 of the New Application flow — screenshot drop zone or pasted job
 * description, with client-side size/type validation.
 */
import { type ImportJobInput } from '@jobmail/shared';
import { ImageOff, ImagePlus, RefreshCw, UploadCloud, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { Mono } from '@/components/Mono';
import { ArrowSquare } from '@/components/ui/arrow-square';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  MAX_IMPORT_CHARS,
  MAX_SCREENSHOT_BYTES,
  MIN_IMPORT_CHARS,
  formatBytes,
} from '@/pages/newApplicationUtils';
import { ProcessingSequence } from '@/pages/new-application/shared';

/* ── Step 1: Upload ─────────────────────────────────────────────── */

type UploadMode = 'screenshot' | 'paste';

interface UploadStepProps {
  analyzing: boolean;
  analyzingPreviewUrl: string | null;
  failed: boolean;
  /** Server-side failure reason (e.g. duplicate) — surfaced in paste mode. */
  failureMessage: string | null;
  uploading: boolean;
  importing: boolean;
  onUpload: (file: File) => void;
  onImport: (input: ImportJobInput) => void;
  onReset: () => void;
  onManualEntry?: () => void;
}

export function UploadStep({
  analyzing,
  analyzingPreviewUrl,
  failed,
  failureMessage,
  uploading,
  importing,
  onUpload,
  onImport,
  onReset,
  onManualEntry,
}: UploadStepProps) {
  const [mode, setMode] = useState<UploadMode>('screenshot');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!file) return;
    setShowTrace(true);
    const timer = setTimeout(() => setShowTrace(false), 1200);
    return () => clearTimeout(timer);
  }, [file]);

  const onDrop = useCallback((accepted: File[], rejected: FileRejection[]) => {
    if (rejected.length > 0) {
      const reason = rejected[0]?.errors[0];
      toast.error(
        reason?.code === 'file-too-large'
          ? 'Screenshot must be 10 MB or smaller.'
          : 'Unsupported file — use a PNG, JPEG, or WebP screenshot.',
      );
      return;
    }
    if (accepted[0]) setFile(accepted[0]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/webp': ['.webp'],
    },
    maxSize: MAX_SCREENSHOT_BYTES,
    multiple: false,
  });

  const trimmedLength = pasteText.trim().length;
  const canImport = trimmedLength >= MIN_IMPORT_CHARS && trimmedLength <= MAX_IMPORT_CHARS;

  const handleImport = () => {
    const url = sourceUrl.trim();
    if (url) {
      try {
        new URL(url);
      } catch {
        setUrlError('Enter a full URL, including https://');
        return;
      }
    }
    setUrlError(null);
    const rawText = pasteText.trim();
    onImport(url ? { rawText, sourceUrl: url } : { rawText });
  };

  /* Analyzing — the AI wait state (shared by both sources). */
  if (analyzing) {
    const pasted = mode === 'paste';
    return (
      <div className="rounded-card border border-graphite bg-ink-2 p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          {analyzingPreviewUrl ? (
            <img
              src={analyzingPreviewUrl}
              alt="Uploaded job screenshot"
              className="h-24 w-24 shrink-0 rounded-btn border border-graphite object-cover opacity-70"
            />
          ) : (
            <Skeleton className="h-24 w-24 shrink-0 rounded-btn bg-ink-3" />
          )}
          <div>
            <Mono size="sm" color="pure">
              {pasted ? 'Analyzing job post' : 'Analyzing screenshot'}
            </Mono>
            <p className="mt-1 font-sans text-sm font-normal text-text-2-dark">
              {pasted
                ? 'Reading the pasted description — usually a few seconds.'
                : 'Vision AI is reading the job post — usually a few seconds.'}
            </p>
            <ProcessingSequence className="mt-3" />
          </div>
        </div>
      </div>
    );
  }

  /* Extraction failed on the server. */
  if (failed) {
    const pasted = mode === 'paste';
    return (
      <div className="rounded-card border border-danger/40 bg-ink-2 p-4">
        <div className="flex items-start gap-3">
          <ImageOff className="mt-0.5 size-5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <Mono size="xs" color="danger">
              {pasted ? 'COULDN’T IMPORT THIS ONE' : 'COULDN’T READ THIS ONE'}
            </Mono>
            <p className="mt-1 font-sans text-sm font-normal text-text-2-dark">
              {pasted
                ? failureMessage ??
                  'We couldn’t process that text. Edit it and try again.'
                : 'We couldn’t read this screenshot. Try a sharper capture — the full job post, in focus.'}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" onClick={onReset}>
                {pasted ? <RefreshCw className="size-4" /> : <UploadCloud className="size-4" />}
                {pasted ? 'Edit the text' : 'Try another screenshot'}
              </Button>
              {onManualEntry && (
                <Button variant="ghost" size="sm" onClick={onManualEntry}>
                  Enter manually
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const modeTab = (value: UploadMode, label: string) => (
    <button
      type="button"
      aria-pressed={mode === value}
      onClick={() => setMode(value)}
      className={cn(
        'focus-ring rounded-nav px-3 py-1.5 font-mono text-[13px] uppercase tracking-[-0.02em] transition-quick',
        'border',
        mode === value
          ? 'border-lime bg-lime text-ink'
          : 'border-graphite text-text-2-dark hover:bg-ink-3',
      )}
    >
      {label}
    </button>
  );

  if (mode === 'paste') {
    return (
      <div className="space-y-5">
        <div role="group" aria-label="Job post source" className="flex items-center gap-2">
          {modeTab('screenshot', 'Screenshot')}
          {modeTab('paste', 'Paste text')}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Mono size="xs" color="fog">JOB DESCRIPTION TEXT</Mono>
            <Mono
              size="xs"
              color={
                trimmedLength > MAX_IMPORT_CHARS
                  ? 'warn'
                  : trimmedLength >= MIN_IMPORT_CHARS
                    ? 'ash'
                    : 'fog'
              }
            >
              {trimmedLength} / {MAX_IMPORT_CHARS}
            </Mono>
          </div>
          <Textarea
            id="import-jd-text"
            aria-label="Job description text"
            rows={10}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={`Paste the full job description — at least ${MIN_IMPORT_CHARS} characters. Include the company, role, and any contact email.`}
          />
        </div>

        <div className="space-y-1.5">
          <Mono size="xs" color="fog">SOURCE URL — OPTIONAL, KEPT AS A REFERENCE</Mono>
          <Input
            id="import-source-url"
            type="url"
            placeholder="https://www.linkedin.com/jobs/view/…"
            value={sourceUrl}
            onChange={(e) => {
              setSourceUrl(e.target.value);
              setUrlError(null);
            }}
            aria-invalid={urlError !== null}
          />
          {urlError && <Mono size="xs" color="danger">{urlError}</Mono>}
        </div>

        <div className="flex items-center justify-end gap-3">
          <Button disabled={!canImport || importing} onClick={handleImport}>
            {importing ? 'Importing…' : 'Import & analyze'}
          </Button>
          {canImport && !importing && <ArrowSquare decorative onClick={handleImport} />}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div role="group" aria-label="Job post source" className="flex items-center gap-2">
          {modeTab('screenshot', 'Screenshot')}
          {modeTab('paste', 'Paste text')}
        </div>
        {/* Phase 8: bulk upload lives on its own page — no main-nav entry. */}
        <Link to="/apps/batch" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          Batch
        </Link>
      </div>

      <div
        {...getRootProps()}
        className={cn(
          'focus-ring relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-btn border border-dashed border-graphite bg-ink px-6 py-12 text-center transition-quick hover:border-lime',
          isDragActive && 'border-lime',
          file && 'border-text-3-dark',
        )}
      >
        <input {...getInputProps()} aria-label="Job post screenshot" />
        {showTrace && (
          <svg className="pointer-events-none absolute inset-0 size-full" preserveAspectRatio="none">
            <rect
              x="0.5"
              y="0.5"
              width="calc(100% - 1px)"
              height="calc(100% - 1px)"
              rx="8"
              ry="8"
              fill="none"
              stroke="var(--border-trace)"
              strokeWidth="1"
              strokeDasharray="1000"
              className="animate-border-trace"
            />
          </svg>
        )}
        <div
          className={cn(
            'flex size-12 items-center justify-center rounded-btn border border-graphite bg-ink-2 text-text-2-dark transition-quick',
            isDragActive && 'border-text-3-dark text-paper',
          )}
        >
          <ImagePlus className="size-6" />
        </div>
        {isDragActive ? (
          <p className="font-sans text-sm font-normal text-paper">Drop the screenshot here</p>
        ) : (
          <>
            <p className="font-sans text-sm font-normal text-paper">
              Drag &amp; drop a job post screenshot, or{' '}
              <span className="text-paper underline underline-offset-4">browse</span>
            </p>
            <Mono size="xs" color="fog">
              PNG, JPEG, or WebP — up to {formatBytes(MAX_SCREENSHOT_BYTES)}
            </Mono>
          </>
        )}
      </div>

      {file && previewUrl && (
        <div className="flex items-center gap-4 rounded-btn border border-graphite bg-ink-2 p-3">
          <img
            src={previewUrl}
            alt={`Preview of ${file.name}`}
            className="h-14 w-14 rounded-btn border border-graphite object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-sans text-sm font-normal text-paper">{file.name}</p>
            <Mono size="xs" color="fog">{formatBytes(file.size)}</Mono>
          </div>
          <button
            type="button"
            aria-label="Remove selected file"
            onClick={() => setFile(null)}
            className="focus-ring rounded-btn p-1.5 text-text-2-dark transition-quick hover:bg-ink-3 hover:text-paper"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        <Button disabled={!file || uploading} onClick={() => file && onUpload(file)}>
          {uploading ? 'Uploading…' : 'Upload & analyze'}
        </Button>
        {file && !uploading && (
          <ArrowSquare decorative onClick={() => onUpload(file)} />
        )}
      </div>
    </div>
  );
}