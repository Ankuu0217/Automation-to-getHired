import {
  ErrorCodes,
  type ImportJobInput,
  type JobPostResponse,
  type SendFailureCode,
  type SendJobInput,
  type Tone,
} from '@jobmail/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  ImageOff,
  ImagePlus,
  Mail,
  MailWarning,
  Paperclip,
  Pencil,
  RefreshCw,
  ScanText,
  UploadCloud,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { Mono } from '@/components/Mono';
import { ProofSheet, recentContactMessage } from '@/components/ProofSheet';
import { StatusLabel } from '@/components/StatusLabel';
import { ArrowSquare } from '@/components/ui/arrow-square';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  ApiRequestError,
  generateJobEmail,
  getJob,
  getProfile,
  importJob,
  jobScreenshotUrl,
  sendJob,
  updateJobDraft,
  updateJobExtraction,
  uploadJobScreenshot,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import {
  MAX_IMPORT_CHARS,
  MAX_SCREENSHOT_BYTES,
  MIN_IMPORT_CHARS,
  defaultHrEmail,
  formatBytes,
  isJobProcessing,
  needsLowConfidenceWarning,
  rankHrEmails,
  type FlowStep,
} from '@/pages/newApplicationUtils';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const UPLOAD_STEPS = [
  'Reading the posting',
  'Locating the contact',
  'Mapping your profile',
  'Setting the email',
];

const DRAFT_STEPS = [
  'Matching your profile',
  'Choosing highlights',
  'Drafting the email',
  'Polishing the tone',
];

/* ── Shared processing sequence ─────────────────────────────────── */

function ProcessingSequence({ steps = UPLOAD_STEPS, className }: { steps?: string[]; className?: string }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setActive((a) => (a + 1) % steps.length), 400);
    return () => clearInterval(id);
  }, [steps.length]);

  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', className)}>
      <span role="status" className="sr-only">
        Processing — please wait.
      </span>
      {steps.map((label, index) => {
        const isActive = index === active;
        const isPast = index < active;
        return (
          <Mono
            key={label}
            size="xs"
            color={isActive ? 'pure' : isPast ? 'ash' : 'fog'}
            className="transition-quick"
            aria-hidden
          >
            {label}
            {index < steps.length - 1 ? ' →' : ''}
          </Mono>
        );
      })}
    </div>
  );
}

/* ── Stepper header ─────────────────────────────────────────────── */

function StepsHeader({ current }: { current: FlowStep }) {
  const stepClass = (active: boolean) =>
    cn(
      'inline-flex items-center gap-2 font-mono text-[13px] uppercase tracking-[-0.02em]',
      active ? 'text-paper' : 'text-text-3-dark',
    );
  return (
    <div className="flex items-center justify-center gap-3">
      <span className={stepClass(current === 1)}>
        {current === 1 && <span aria-hidden className="size-1.5 rounded-full bg-lime" />}
        01 UPLOAD
      </span>
      <span aria-hidden className="text-text-3-dark">·</span>
      <span className={stepClass(current === 2)}>
        {current === 2 && <span aria-hidden className="size-1.5 rounded-full bg-lime" />}
        02 REVIEW
      </span>
      <span aria-hidden className="text-text-3-dark">·</span>
      <span className={stepClass(current === 3)}>
        {current === 3 && <span aria-hidden className="size-1.5 rounded-full bg-lime" />}
        03 SEND
      </span>
    </div>
  );
}

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

function UploadStep({
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
        mode === value
          ? 'bg-lime text-ink'
          : 'border border-graphite text-text-2-dark hover:bg-ink-3',
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

/* ── Shared disclosure ──────────────────────────────────────────── */

function Disclosure({
  title,
  children,
  mono = false,
}: {
  title: string;
  children: string;
  mono?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <div className="rounded-btn border border-graphite bg-ink-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="focus-ring flex w-full items-center justify-between rounded-btn px-4 py-3 transition-quick hover:bg-ink-3"
        aria-expanded={open}
        aria-controls={contentId}
      >
        <Mono size="xs" color="pure">{title}</Mono>
        <ChevronDown className={cn('size-4 text-text-2-dark transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          id={contentId}
          className={cn(
            'max-h-64 overflow-y-auto border-t border-graphite px-4 py-3 text-sm leading-relaxed text-text-2-dark',
            mono && 'font-mono text-xs uppercase tracking-[0.016em]',
          )}
        >
          {children || 'Nothing extracted.'}
        </div>
      )}
    </div>
  );
}

/* ── Step 2: Review extraction ──────────────────────────────────── */

function HrEmailSection({
  job,
  selectedEmail,
  customEmail,
  emailError,
  onSelect,
  onCustomChange,
}: {
  job: JobPostResponse;
  selectedEmail: string;
  customEmail: string;
  emailError: string | null;
  onSelect: (email: string) => void;
  onCustomChange: (value: string) => void;
}) {
  const ranked = rankHrEmails(job.extraction?.hrEmails ?? []);
  const [customMode, setCustomMode] = useState(job.needsEmail || ranked.length === 0);

  /* Edge case 1: no email in the screenshot — manual entry, never blocking. */
  if (ranked.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-card border border-warn/40 bg-ink-2 p-4">
          <div className="flex items-start gap-3">
            <MailWarning className="mt-0.5 size-5 shrink-0 text-warn" />
            <div className="min-w-0 flex-1">
              <Mono size="xs" color="warn">NO CONTACT FOUND</Mono>
              <p className="mt-1 font-sans text-sm font-normal text-text-2-dark">
                Paste the HR email manually — you can continue either way.
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <Mono size="xs" color="fog">HR EMAIL</Mono>
          <Input
            id="hr-email-manual"
            type="email"
            placeholder="recruiter@company.com"
            value={customEmail}
            onChange={(e) => onCustomChange(e.target.value)}
          />
          {emailError && (
            <Mono size="xs" color="danger">{emailError}</Mono>
          )}
        </div>
      </div>
    );
  }

  /* Edge case 2: ranked candidates with confidence; exactly one is preselected. */
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="HR email candidates" className="space-y-2">
        {ranked.map((candidate, index) => {
          const selected = !customMode && selectedEmail === candidate.email;
          return (
            <button
              key={candidate.email}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                setCustomMode(false);
                onSelect(candidate.email);
              }}
              className={cn(
                'focus-ring flex w-full items-center gap-3 rounded-btn border px-4 py-3 text-left transition-quick',
                selected
                  ? 'border-lime bg-ink-2'
                  : 'border-graphite bg-ink-2 hover:border-text-3-dark',
              )}
            >
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-graphite transition-quick">
                {selected && <span className="size-1.5 rounded-full bg-lime" />}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs normal-case tracking-[0.016em] text-paper">
                {candidate.email}
              </span>
              {index === 0 && (
                <Mono size="xs" color="cyan">SUGGESTED</Mono>
              )}
              <Mono size="xs" color={candidate.confidence < 0.5 ? 'warn' : 'fog'}>
                CONF · {candidate.confidence.toFixed(2)}
              </Mono>
            </button>
          );
        })}

        <button
          type="button"
          role="radio"
          aria-checked={customMode}
          onClick={() => setCustomMode(true)}
          className={cn(
            'focus-ring flex w-full items-center gap-3 rounded-btn border px-4 py-3 text-left transition-quick',
            customMode
              ? 'border-lime bg-ink-2'
              : 'border-graphite bg-ink-2 hover:border-text-3-dark',
          )}
        >
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-graphite transition-quick">
            {customMode && <span className="size-1.5 rounded-full bg-lime" />}
          </span>
          <span className="font-sans text-sm font-normal text-paper">Use a different email</span>
        </button>
      </div>

      {customMode && (
        <div className="space-y-1.5 pt-1">
          <Mono size="xs" color="fog">CUSTOM HR EMAIL</Mono>
          <Input
            id="hr-email-custom"
            type="email"
            placeholder="recruiter@company.com"
            value={customEmail}
            onChange={(e) => onCustomChange(e.target.value)}
          />
          {emailError && (
            <Mono size="xs" color="danger">{emailError}</Mono>
          )}
        </div>
      )}
      {!customMode && emailError && (
        <Mono size="xs" color="danger">{emailError}</Mono>
      )}
    </div>
  );
}

function ScreenshotThumb({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  const url = jobScreenshotUrl(jobId);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      // The close button is the dialog's only focusable element.
      if (event.key === 'Tab') {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      triggerRef.current?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !broken && setOpen(true)}
        className="focus-ring group block w-full overflow-hidden rounded-btn border border-graphite"
        aria-label="View screenshot larger"
      >
        {broken ? (
          <div className="flex h-40 items-center justify-center gap-2 font-sans text-sm text-text-2-dark">
            <ImageOff className="size-4" /> Screenshot unavailable
          </div>
        ) : (
          <img
            src={url}
            alt="Job post screenshot"
            onError={() => setBroken(true)}
            className="max-h-64 w-full object-cover object-top transition-opacity group-hover:opacity-80"
          />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="dialog"
            aria-modal="true"
            aria-label="Job post screenshot"
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-6 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <button
              ref={closeRef}
              type="button"
              aria-label="Close screenshot preview"
              onClick={() => setOpen(false)}
              className="focus-ring absolute right-4 top-4 rounded-btn p-2 text-text-2-dark transition-quick hover:bg-ink-3 hover:text-paper"
            >
              <X className="size-5" />
            </button>
            <motion.img
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.15 }}
              src={url}
              alt="Job post screenshot, enlarged"
              className="max-h-full max-w-4xl rounded-btn border border-graphite object-contain"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function MatchDial({ score }: { score: number }) {
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);

  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={score}
      aria-label="Match score"
      className="flex items-center gap-4"
    >
      <div className="relative size-14 shrink-0" aria-hidden="true">
        <svg viewBox="0 0 56 56" className="size-full -rotate-90">
          <circle
            cx="28"
            cy="28"
            r={radius}
            fill="none"
            stroke="var(--graphite)"
            strokeWidth="1.5"
          />
          <circle
            cx="28"
            cy="28"
            r={radius}
            fill="none"
            stroke="var(--lime)"
            strokeWidth="1.5"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-sans text-subheading font-normal text-paper">
            {score}
            <span className="ml-0.5 font-sans text-[10px] text-text-2-dark">%</span>
          </span>
        </div>
      </div>
      <span aria-hidden="true">
        <Mono size="xs" color="ash">MATCH</Mono>
      </span>
    </div>
  );
}

function ReviewStep({ job, onContinue }: { job: JobPostResponse; onContinue: () => void }) {
  const queryClient = useQueryClient();
  const extraction = job.extraction;
  const confidence = extraction?.confidence;
  const match = job.match;

  const [company, setCompany] = useState(extraction?.company ?? '');
  const [role, setRole] = useState(extraction?.role ?? '');
  const [location, setLocation] = useState(extraction?.location ?? '');
  const [hrName, setHrName] = useState(extraction?.hrName ?? '');
  const [selectedEmail, setSelectedEmail] = useState<string>(
    defaultHrEmail(extraction?.hrEmails ?? [], job.hrEmail) ?? '',
  );
  const [customEmail, setCustomEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);

  const lowConfidence = needsLowConfidenceWarning(job);
  const isOcr = extraction?.source === 'ocr';

  const hasChanges = useMemo(() => {
    return (
      company.trim() !== (extraction?.company ?? '') ||
      role.trim() !== (extraction?.role ?? '') ||
      location.trim() !== (extraction?.location ?? '') ||
      hrName.trim() !== (extraction?.hrName ?? '') ||
      selectedEmail !== (job.hrEmail ?? '') ||
      customEmail.trim() !== ''
    );
  }, [company, role, location, hrName, selectedEmail, customEmail, extraction, job.hrEmail]);

  const saveMutation = useMutation({
    mutationFn: (email: string | null) =>
      updateJobExtraction(job.id, {
        company: company.trim() || null,
        role: role.trim() || null,
        location: location.trim() || null,
        hrName: hrName.trim() || null,
        hrEmail: email,
      }),
    onSuccess: (data) => {
      setDuplicateId(null);
      setEmailError(null);
      queryClient.setQueryData(['job', job.id], data);
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast.success('Extraction saved');
    },
    onError: (error) => {
      if (error instanceof ApiRequestError) {
        if (error.code === ErrorCodes.DUPLICATE_APPLICATION) {
          const details = error.details as { existingJobPostId?: string } | undefined;
          setDuplicateId(details?.existingJobPostId ?? null);
          toast.error('Duplicate application detected');
          return;
        }
        if (error.status === 400) {
          setEmailError(error.message);
          return;
        }
      }
      toast.error(error instanceof Error ? error.message : 'Could not save the extraction.');
    },
  });

  const resolveEmail = (): string | null | undefined => {
    const manual = customEmail.trim();
    if (manual) {
      if (!EMAIL_RE.test(manual)) {
        setEmailError('Enter a valid email address.');
        return undefined;
      }
      return manual.toLowerCase();
    }
    if (selectedEmail) return selectedEmail;
    return null;
  };

  const handleSave = () => {
    setDuplicateId(null);
    setEmailError(null);
    const email = resolveEmail();
    if (email === undefined) return;
    saveMutation.mutate(email);
  };

  const field = (
    id: string,
    label: string,
    value: string,
    setValue: (v: string) => void,
    placeholder: string,
  ) => {
    const warn = confidence != null && confidence < 0.5;
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Mono size="xs" color={warn ? 'warn' : 'fog'}>{label}</Mono>
          {confidence != null && (
            <Mono size="xs" color={warn ? 'warn' : 'fog'}>
              CONF · {confidence.toFixed(2)}
            </Mono>
          )}
        </div>
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={warn}
        />
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Edge case 3: low-confidence banner + raw text */}
      {lowConfidence && (
        <div className="rounded-card border border-warn/40 bg-ink-2 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" />
            <div className="min-w-0 flex-1">
              <Mono size="xs" color="warn">LOW CONFIDENCE EXTRACTION</Mono>
              <p className="mt-1 font-sans text-sm font-normal text-text-2-dark">
                Please verify the fields below — the screenshot may have been blurry or cropped.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Phase 4: double-outreach note — informational only, never blocks. */}
      {job.recentContact && (
        <div className="rounded-card border border-warn/40 bg-ink-2 p-4">
          <div className="flex items-start gap-3">
            <Mail className="mt-0.5 size-5 shrink-0 text-warn" />
            <div className="min-w-0 flex-1">
              <Mono size="xs" color="warn">RECENT CONTACT</Mono>
              <p className="mt-1 font-sans text-sm font-normal text-text-2-dark">
                {recentContactMessage(job.recentContact)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Edge case 4: duplicate warning */}
      {duplicateId !== null && (
        <div className="rounded-card border border-danger/40 bg-ink-2 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <Mono size="xs" color="danger">DUPLICATE APPLICATION</Mono>
              <p className="mt-1 font-sans text-sm font-normal text-text-2-dark">
                You already have an application for this email + company + role.
              </p>
              {duplicateId && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Link
                    to={`/apps/new?job=${duplicateId}`}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    Open existing application
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        {/* Screenshot (or import source link) + disclosures */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          {job.hasScreenshot !== false ? (
            <ScreenshotThumb jobId={job.id} />
          ) : job.sourceUrl ? (
            /* Text imports: the URL is a stored reference only — never fetched by the server. */
            <a
              href={job.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="focus-ring flex items-center gap-3 rounded-btn border border-graphite bg-ink-2 px-4 py-3 transition-quick hover:bg-ink-3"
            >
              <ExternalLink className="size-4 shrink-0 text-text-2-dark" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs normal-case tracking-[0.016em] text-paper">
                {job.sourceUrl}
              </span>
              <Mono size="xs" color="fog">SOURCE</Mono>
            </a>
          ) : null}
          {extraction?.jdText && <Disclosure title="Job description">{extraction.jdText}</Disclosure>}
          {lowConfidence && (
            <Disclosure title="Raw extracted text" mono>
              {job.rawExtractedText}
            </Disclosure>
          )}
        </div>

        {/* Editable extraction fields */}
        <div className="space-y-5 rounded-card border border-graphite bg-ink-2 p-6">
          {extraction?.jdText && match && (
            <div className="flex items-start justify-between gap-4 border-b border-graphite pb-5">
              <div className="min-w-0 flex-1">
                <Mono size="xs" color="fog">JD SUMMARY</Mono>
                <p className="mt-1 line-clamp-3 font-sans text-sm font-normal text-text-2-dark">
                  {extraction.jdText}
                </p>
              </div>
              <MatchDial score={match.score} />
            </div>
          )}

          <div className="flex items-center justify-between">
            <Mono size="xs" color="pure">EXTRACTED DETAILS</Mono>
            {isOcr && (
              <span title="Vision AI unavailable — extracted via OCR, please double-check">
                <Mono size="xs" color="cyan" className="inline-flex items-center gap-1">
                  <ScanText className="size-3" />
                  OCR MODE
                </Mono>
              </span>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {field('f-company', 'COMPANY', company, setCompany, 'Acme Inc.')}
            {field('f-role', 'ROLE', role, setRole, 'Senior Frontend Engineer')}
            {field('f-location', 'LOCATION', location, setLocation, 'Bengaluru / Remote')}
            {field('f-hrname', 'HR NAME', hrName, setHrName, 'Priya Sharma')}
          </div>

          <div className="border-t border-graphite pt-5">
            <div className="mb-2 flex items-center justify-between">
              <Mono size="xs" color="fog">HR EMAIL</Mono>
              {confidence != null && (
                <Mono size="xs" color={confidence < 0.5 ? 'warn' : 'fog'}>
                  CONF · {confidence.toFixed(2)}
                </Mono>
              )}
            </div>
            <HrEmailSection
              job={job}
              selectedEmail={selectedEmail}
              customEmail={customEmail}
              emailError={emailError}
              onSelect={(email) => {
                setSelectedEmail(email);
                setEmailError(null);
              }}
              onCustomChange={(value) => {
                setCustomEmail(value);
                setEmailError(null);
              }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
            <Button
              variant="outline"
              onClick={handleSave}
              disabled={!hasChanges || saveMutation.isPending}
            >
              Save changes
            </Button>
            <Button onClick={onContinue}>Continue</Button>
            <ArrowSquare decorative onClick={onContinue} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Step 3: Email preview + send (M3) ──────────────────────────── */

/** FirstName_LastName_Resume.pdf from the profile name. */
function resumeAttachmentName(fullName: string): string {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .map((p) => p.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean);
  if (parts.length === 0) return 'Resume.pdf';
  const nameParts = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0]];
  return `${[...nameParts, 'Resume'].join('_')}.pdf`;
}

function tomorrowNineAmIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function sendFailureTitle(code: SendFailureCode | null): string {
  switch (code) {
    case 'MX_INVALID_DOMAIN':
      return "That email address can't receive mail";
    case 'RESUME_MISSING':
      return 'No resume on file';
    case 'GMAIL_NOT_CONNECTED':
      return 'Gmail got disconnected';
    default:
      return 'Sending failed';
  }
}

function SendFailurePanel({
  job,
  retrying,
  onFixEmail,
  onRetry,
}: {
  job: JobPostResponse;
  retrying: boolean;
  onFixEmail: () => void;
  onRetry: () => void;
}) {
  const code = job.failureCode;
  return (
    <div className="rounded-card border border-danger/40 bg-ink-2 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <Mono size="xs" color="danger">{sendFailureTitle(code).toUpperCase()}</Mono>
          <p className="mt-1 font-sans text-sm font-normal text-text-2-dark">
            {job.error ?? 'Something went wrong while sending this email.'}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {code === 'MX_INVALID_DOMAIN' && (
              <Button size="sm" onClick={onFixEmail}>
                <Pencil className="size-4" />
                Fix the email
              </Button>
            )}
            {code === 'RESUME_MISSING' && (
              <Link to="/onboarding" className={buttonVariants({ size: 'sm' })}>
                <UploadCloud className="size-4" />
                Upload your resume
              </Link>
            )}
            {code === 'GMAIL_NOT_CONNECTED' && (
              <Link to="/settings" className={buttonVariants({ size: 'sm' })}>
                <Mail className="size-4" />
                Connect Gmail
              </Link>
            )}
            <Button
              size="sm"
              variant={code === 'SEND_FAILED' || code === null ? 'default' : 'outline'}
              onClick={onRetry}
              disabled={retrying}
            >
              <RefreshCw className="size-4" />
              Try again
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SendStatusCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-graphite bg-ink-2 p-10 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-graphite bg-ink">
        {icon}
      </div>
      <Mono size="sm" color="pure" className="mt-4 block">{title}</Mono>
      <div className="mx-auto mt-1 max-w-sm font-sans text-sm font-normal text-text-2-dark">{children}</div>
      <Link
        to="/dashboard"
        className={cn(buttonVariants({ variant: 'outline' }), 'mt-6')}
      >
        Back to dashboard
      </Link>
    </div>
  );
}

function EmailPreviewStep({ job, onBack }: { job: JobPostResponse; onBack: () => void }) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const profileQuery = useQuery({ queryKey: ['profile'], queryFn: getProfile });

  const [pendingSend, setPendingSend] = useState<'now' | 'scheduled' | null>(null);
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [tone, setTone] = useState<Tone>(user?.settings.tone ?? 'formal');

  /* Poll the job while a send-now is in flight (the parent only polls 'processing'). */
  const liveQuery = useQuery({
    queryKey: ['job', job.id],
    queryFn: () => getJob(job.id),
    refetchInterval: (query) =>
      query.state.data?.job.status === 'queued' && pendingSend === 'now' ? 2000 : false,
  });
  const current = liveQuery.data?.job ?? job;
  const match = current.match;
  const hasDraft = Boolean(current.draft.subject.trim() || current.draft.bodyText.trim());

  const generateMutation = useMutation({
    mutationFn: () => generateJobEmail(job.id),
    onSuccess: (data) => {
      queryClient.setQueryData(['job', job.id], data);
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not generate the email.');
    },
  });

  /* Auto-generate once when arriving without a draft. */
  const triedGenerate = useRef(false);
  useEffect(() => {
    if (triedGenerate.current || hasDraft) return;
    if (current.status === 'queued' || current.status === 'sent') return;
    triedGenerate.current = true;
    generateMutation.mutate();
  }, [hasDraft, current.status, generateMutation]);

  const saveEditMutation = useMutation({
    mutationFn: () => updateJobDraft(job.id, { subject: editSubject.trim(), bodyText: editBody }),
    onSuccess: (data) => {
      queryClient.setQueryData(['job', job.id], data);
      setEditing(false);
      toast.success('Draft saved.');
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not save the draft.');
    },
  });

  const toneMutation = useMutation({
    mutationFn: (next: Tone) => updateJobDraft(job.id, { tone: next }),
    onSuccess: (data, next) => {
      queryClient.setQueryData(['job', job.id], data);
      setTone(next);
      toast.success(`Regenerated in a ${next} tone.`);
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not regenerate the email.');
    },
  });

  const sendMutation = useMutation({
    mutationFn: (input: SendJobInput) => sendJob(job.id, input),
    onSuccess: (data, input) => {
      setScheduledAt(data.scheduledAt);
      setPendingSend(input.scheduledAt ? 'scheduled' : 'now');
      void queryClient.invalidateQueries({ queryKey: ['job', job.id] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not queue the email.');
    },
  });

  const handleEditingChange = useCallback(
    (value: boolean) => {
      if (value) {
        setEditSubject(current.draft.subject);
        setEditBody(current.draft.bodyText);
      }
      setEditing(value);
    },
    [current.draft],
  );

  /* ── Send lifecycle states ── */
  if (current.status === 'sent') {
    return (
      <SendStatusCard
        icon={<CheckCircle2 className="size-6 text-paper" />}
        title="EMAIL SENT"
      >
        Your outreach to <span className="text-paper">{current.hrEmail}</span> is on its way.
      </SendStatusCard>
    );
  }

  if (current.status === 'failed' && current.failureCode) {
    return (
      <SendFailurePanel
        job={current}
        retrying={sendMutation.isPending}
        onFixEmail={onBack}
        onRetry={() => sendMutation.mutate({})}
      />
    );
  }

  if (current.status === 'queued') {
    if (pendingSend === 'scheduled' && scheduledAt) {
      return (
        <SendStatusCard
          icon={<CalendarClock className="size-6 text-paper" />}
          title={`SCHEDULED FOR ${formatDateTime(scheduledAt)}`}
        >
          It goes out automatically — send caps and human-like jitter are already applied.
        </SendStatusCard>
      );
    }
    return (
      <div className="rounded-card border border-graphite bg-ink-2 p-10 text-center">
        <StatusLabel status="queued" className="mx-auto" />
        <Mono size="sm" color="pure" className="mt-4 block">SENDING</Mono>
        <p className="mx-auto mt-1 max-w-sm font-sans text-sm font-normal text-text-2-dark">
          Queued with human-like jitter — usually out within a few minutes.
        </p>
      </div>
    );
  }

  /* ── No draft yet: auto-generation states ── */
  if (!hasDraft) {
    if (generateMutation.isError) {
      const message =
        generateMutation.error instanceof ApiRequestError
          ? generateMutation.error.message
          : 'The AI provider could not write the email.';
      return (
        <div className="rounded-card border border-danger/40 bg-ink-2 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <Mono size="xs" color="danger">COULDN&apos;T GENERATE THE EMAIL</Mono>
              <p className="mt-1 font-sans text-sm font-normal text-text-2-dark">{message}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button size="sm" variant="ghost" onClick={onBack}>
                  <ArrowLeft className="size-4" />
                  Back to review
                </Button>
                <Button
                  size="sm"
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending}
                >
                  <RefreshCw className="size-4" />
                  Try again
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="rounded-card border border-graphite bg-ink-2 p-6">
        <Mono size="sm" color="pure">Writing your outreach email…</Mono>
        <p className="mt-1 font-sans text-sm font-normal text-text-2-dark">
          Matching your profile against the job description, then drafting.
        </p>
        <ProcessingSequence steps={DRAFT_STEPS} className="mt-4" />
      </div>
    );
  }

  /* ── Draft ready: preview, edit, tone, send ── */
  const busy = generateMutation.isPending || toneMutation.isPending;
  const actionsDisabled = busy || sendMutation.isPending || editing;
  const profile = profileQuery.data?.profile;
  const resumeName = profile?.resumeFile ? resumeAttachmentName(profile.fullName) : null;

  const footerActions = (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <Button
        variant="outline"
        onClick={() => sendMutation.mutate({ scheduledAt: tomorrowNineAmIso() })}
        disabled={actionsDisabled}
      >
        <CalendarClock className="size-4" />
        Tomorrow 9 AM
      </Button>
      <Button onClick={() => sendMutation.mutate({})} disabled={actionsDisabled}>
        {sendMutation.isPending ? 'Sending…' : 'Send now'}
      </Button>
      {!actionsDisabled && (
        <ArrowSquare decorative onClick={() => sendMutation.mutate({})} />
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {current.lowMatch && match && (
        <div className="rounded-card border border-warn/40 bg-ink-2 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" />
            <div className="min-w-0 flex-1">
              <Mono size="xs" color="warn">LOW MATCH — {match.score}%</Mono>
              <p className="mt-1 font-sans text-sm font-normal text-text-2-dark">
                This role looks like a stretch for your profile. The email leans on your strongest
                transferable skills — review it carefully before sending.
              </p>
            </div>
          </div>
        </div>
      )}

      {!user?.gmailConnected && (
        <div className="rounded-card border border-warn/40 bg-ink-2 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" />
            <div className="min-w-0 flex-1">
              <Mono size="xs" color="warn">GMAIL NOT CONNECTED</Mono>
              <p className="mt-1 font-sans text-sm font-normal text-text-2-dark">
                Connect it in Settings before this email can send.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Link to="/settings" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  Connect Gmail
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {!resumeName && (
        <div className="rounded-card border border-warn/40 bg-ink-2 p-4">
          <div className="flex items-start gap-3">
            <Paperclip className="mt-0.5 size-5 shrink-0 text-warn" />
            <div className="min-w-0 flex-1">
              <Mono size="xs" color="warn">NO RESUME ON FILE</Mono>
              <p className="mt-1 font-sans text-sm font-normal text-text-2-dark">
                Upload one before sending — without it the send will fail.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Link to="/onboarding" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  Upload resume
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      <ProofSheet
        fromName={user?.name ?? ''}
        fromEmail={user?.email ?? ''}
        toName={current.extraction?.hrName ?? null}
        toEmail={current.hrEmail ?? ''}
        subject={editing ? editSubject : current.draft.subject}
        body={editing ? editBody : current.draft.bodyText}
        attachmentName={resumeName ?? undefined}
        tone={tone}
        recentContact={current.recentContact ?? null}
        isGenerating={busy}
        isSending={sendMutation.isPending}
        editing={editing}
        footerActions={footerActions}
        onToneChange={(next) => toneMutation.mutate(next)}
        onRegenerate={() => generateMutation.mutate()}
        onSend={() => sendMutation.mutate({})}
        onEditingChange={handleEditingChange}
        onSubjectChange={setEditSubject}
        onBodyChange={setEditBody}
        onSave={() => saveEditMutation.mutate()}
      />
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────── */

export function NewApplication() {
  const [searchParams] = useSearchParams();
  const jobParam = searchParams.get('job');

  const [jobId, setJobId] = useState<string | null>(jobParam);
  const [step, setStep] = useState<FlowStep>(jobParam ? 2 : 1);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  const announcedRef = useRef<string | null>(null);

  /* React to ?job= changes (duplicate-warning link, dashboard rows). */
  useEffect(() => {
    if (jobParam && jobParam !== jobId) {
      setJobId(jobParam);
      setStep(2);
      setLocalPreviewUrl(null);
      setManualEntry(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobParam]);

  const jobQuery = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => getJob(jobId as string),
    enabled: jobId !== null,
    refetchInterval: (query) => (isJobProcessing(query.state.data?.job.status) ? 1500 : false),
  });

  const job = jobQuery.data?.job ?? null;
  const processing = job !== null && isJobProcessing(job.status);

  /* Revoke the upload-preview object URL when it is replaced or on unmount. */
  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);

  /* Auto-advance once extraction finishes (edge case toasts included). */
  useEffect(() => {
    if (!job || step !== 1 || jobId === null) return;
    if (job.status === 'processing' || job.status === 'failed') return;
    const key = `${job.id}:${job.status}`;
    if (announcedRef.current !== key) {
      announcedRef.current = key;
      if (job.status === 'needs_review') {
        toast.warning('Extraction needs review — please verify the fields.');
      } else {
        toast.success('Extraction complete');
      }
    }
    setStep(2);
  }, [job, step, jobId]);

  const uploadMutation = useMutation({
    mutationFn: uploadJobScreenshot,
    onSuccess: (data, file) => {
      setLocalPreviewUrl(URL.createObjectURL(file));
      setJobId(data.jobPostId);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Upload failed — please try again.');
    },
  });

  /* Pasted-text import — same 202 → poll contract as the screenshot upload. */
  const importMutation = useMutation({
    mutationFn: importJob,
    onSuccess: (data) => {
      setJobId(data.jobPostId);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Import failed — please try again.');
    },
  });

  const handleReset = useCallback(() => {
    setJobId(null);
    setLocalPreviewUrl(null);
    setManualEntry(false);
    setStep(1);
    announcedRef.current = null;
  }, []);

  const handleManualEntry = useCallback(() => {
    setManualEntry(true);
    setStep(2);
  }, []);

  const stepContent = useMemo(() => {
    if (manualEntry && jobId && jobQuery.isSuccess && job) {
      return <ReviewStep key={job.id} job={job} onContinue={() => setStep(3)} />;
    }

    if ((step === 2 || step === 3) && jobId) {
      if (jobQuery.isPending) {
        return (
          <div className="space-y-4 rounded-card border border-graphite bg-ink-2 p-6">
            <Skeleton className="h-5 w-40 bg-ink-3" />
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3 w-20 bg-ink-3" />
                  <Skeleton className="h-9 w-full bg-ink-3" />
                </div>
              ))}
            </div>
            <Skeleton className="h-12 w-full bg-ink-3" />
            <Skeleton className="h-12 w-full bg-ink-3" />
          </div>
        );
      }
      if (jobQuery.isError || !job) {
        return (
          <div className="rounded-card border border-danger/40 bg-ink-2 p-4">
            <div className="flex items-start gap-3">
              <ImageOff className="mt-0.5 size-5 shrink-0 text-danger" />
              <div className="min-w-0 flex-1">
                <Mono size="xs" color="danger">COULDN&apos;T LOAD THIS APPLICATION</Mono>
                <p className="mt-1 font-sans text-sm font-normal text-text-2-dark">
                  The application didn&apos;t come back from the server — try again.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button variant="outline" size="sm" onClick={() => void jobQuery.refetch()}>
                    <RefreshCw className="size-4" />
                    Retry
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      }
      if (step === 3) {
        return <EmailPreviewStep key={job.id} job={job} onBack={() => setStep(2)} />;
      }
      return <ReviewStep key={job.id} job={job} onContinue={() => setStep(3)} />;
    }

    return (
      <UploadStep
        analyzing={
          uploadMutation.isPending ||
          importMutation.isPending ||
          (jobId !== null && (jobQuery.isPending || processing))
        }
        analyzingPreviewUrl={localPreviewUrl}
        failed={job?.status === 'failed'}
        failureMessage={job?.error ?? null}
        uploading={uploadMutation.isPending}
        importing={importMutation.isPending}
        onUpload={(file) => uploadMutation.mutate(file)}
        onImport={(input) => importMutation.mutate(input)}
        onReset={handleReset}
        onManualEntry={handleManualEntry}
      />
    );
  }, [
    step,
    jobId,
    job,
    jobQuery.isPending,
    jobQuery.isSuccess,
    jobQuery.isError,
    processing,
    localPreviewUrl,
    uploadMutation,
    importMutation,
    jobQuery.refetch,
    manualEntry,
    handleReset,
    handleManualEntry,
  ]);

  return (
    <div className="space-y-8 animate-fade-in-up">
      <StepsHeader current={manualEntry ? 2 : step} />

      <AnimatePresence mode="wait">
        <motion.div
          key={`${manualEntry ? 'manual' : ''}${step}`}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          {stepContent}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
