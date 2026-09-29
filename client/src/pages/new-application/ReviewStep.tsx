/**
 * Step 2 of the New Application flow — review/edit the extracted job fields,
 * pick or enter the HR email, see the screenshot and match score.
 */
import { FindEmailPanel } from '@/components/FindEmailPanel';
import { ErrorCodes, type JobPostResponse } from '@jobmail/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  AlertTriangle,
  ExternalLink,
  ImageOff,
  Mail,
  MailWarning,
  ScanText,
  UploadCloud,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { Mono } from '@/components/Mono';
import { recentContactMessage } from '@/components/ProofSheet';
import { ArrowSquare } from '@/components/ui/arrow-square';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiRequestError, jobScreenshotUrl, updateJobExtraction } from '@/lib/api';
import { CountUp, EASE_OUT } from '@/lib/motion';
import { cn } from '@/lib/utils';
import {
  defaultHrEmail,
  needsLowConfidenceWarning,
  rankHrEmails,
} from '@/pages/newApplicationUtils';
import { Disclosure, EMAIL_RE } from '@/pages/new-application/shared';

/* ── Step 2: Review extraction ──────────────────────────────────── */

function HrEmailSection({
  job,
  selectedEmail,
  customEmail,
  emailError,
  onSelect,
  onCustomChange,
  company,
  hrName,
}: {
  company: string;
  hrName: string;
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
                The post has no email. Find the recruiter’s address below, or paste one you know.
              </p>
            </div>
          </div>
        </div>
        <FindEmailPanel jobId={job.id} company={company} hrName={hrName} onPick={onCustomChange} />
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
  const reduce = useReducedMotion();
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
          {/* Ring draws in from empty to the score on mount. */}
          <motion.circle
            cx="28"
            cy="28"
            r={radius}
            fill="none"
            stroke="var(--lime)"
            strokeWidth="1.5"
            strokeDasharray={circumference}
            strokeLinecap="round"
            initial={{ strokeDashoffset: reduce ? offset : circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={reduce ? { duration: 0 } : { duration: 0.9, ease: EASE_OUT, delay: 0.15 }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-sans text-subheading font-normal text-paper">
            <CountUp value={score} format={(n) => Math.round(n).toString()} duration={0.9} />
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

export function ReviewStep({
  job,
  onContinue,
  onReset,
}: {
  job: JobPostResponse;
  onContinue: () => void;
  onReset: () => void;
}) {
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
  // Extraction came back completely empty (screenshot unreadable / paste had no
  // structure): the review form is blank and the user must type it all in.
  const extractionEmpty =
    !extraction?.company &&
    !extraction?.role &&
    !extraction?.location &&
    !extraction?.hrName &&
    (extraction?.hrEmails?.length ?? 0) === 0;

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

  /**
   * Continue → email step. Persist first when there are unsaved manual edits or
   * the job isn't yet draftable (a degraded extraction), so what the user typed
   * is saved AND the status recovers to a draftable state — otherwise the email
   * step would 400 with "extraction has not completed yet". Only advances once
   * the save actually succeeds (a duplicate/validation error blocks it).
   */
  const handleContinue = () => {
    const mustPersist = hasChanges || job.status === 'failed';
    if (!mustPersist) {
      onContinue();
      return;
    }
    setDuplicateId(null);
    setEmailError(null);
    const email = resolveEmail();
    if (email === undefined) return;
    saveMutation.mutate(email, { onSuccess: () => onContinue() });
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
              <Mono size="xs" color="warn">
                {extractionEmpty ? 'COULDN’T READ IT — ENTER MANUALLY' : 'LOW CONFIDENCE EXTRACTION'}
              </Mono>
              <p className="mt-1 font-sans text-sm font-normal text-text-2-dark">
                {extractionEmpty
                  ? 'The AI couldn’t read this screenshot (all engines were busy or unavailable). Type the company, role and HR email below — or go back and use Paste text with the post’s text. Settings → AI engines shows what’s wrong.'
                  : 'Please verify the fields below — the screenshot may have been blurry or cropped.'}
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
              company={company}
              hrName={hrName}
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

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onReset}
              disabled={saveMutation.isPending}
            >
              <UploadCloud className="mr-2 size-4" />
              Re-upload screenshot
            </Button>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button
                variant="outline"
                onClick={handleSave}
                disabled={!hasChanges || saveMutation.isPending}
              >
                Save changes
              </Button>
              <Button onClick={handleContinue} disabled={saveMutation.isPending}>
                Continue
              </Button>
              <ArrowSquare decorative onClick={handleContinue} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}