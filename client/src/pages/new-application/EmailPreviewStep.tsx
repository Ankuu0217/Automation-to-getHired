/**
 * Step 3 of the New Application flow — generated email preview/editing, tone
 * switch, send-now / schedule, and send status / failure reporting.
 */
import {
  type JobPostResponse,
  type SendFailureCode,
  type SendJobInput,
  type Tone,
} from '@jobmail/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Mail,
  Paperclip,
  Pencil,
  RefreshCw,
  UploadCloud,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { Mono } from '@/components/Mono';
import { ProofSheet } from '@/components/ProofSheet';
import { StatusLabel } from '@/components/StatusLabel';
import { ArrowSquare } from '@/components/ui/arrow-square';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  ApiRequestError,
  generateJobEmail,
  getJob,
  getProfile,
  getQueueHealth,
  sendJob,
  updateJobDraft,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import { DRAFT_STEPS, ProcessingSequence } from '@/pages/new-application/shared';

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
  onEditAndRetry,
  onBackToReview,
}: {
  job: JobPostResponse;
  retrying: boolean;
  onFixEmail: () => void;
  onRetry: () => void;
  onEditAndRetry: () => void;
  onBackToReview: () => void;
}) {
  const code = job.failureCode;
  const canEdit = code === 'SEND_FAILED' || code === null || code === undefined;
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
            {canEdit && (
              <Button size="sm" onClick={onEditAndRetry}>
                <Pencil className="size-4" />
                Edit & retry
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={onRetry}
              disabled={retrying}
            >
              <RefreshCw className="size-4" />
              Try again now
            </Button>
            <Button size="sm" variant="ghost" onClick={onBackToReview}>
              <ArrowLeft className="size-4" />
              Back to review
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

export function EmailPreviewStep({
  job,
  onBack,
  onReset,
}: {
  job: JobPostResponse;
  onBack: () => void;
  onReset: () => void;
}) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const profileQuery = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const queueHealthQuery = useQuery({ queryKey: ['queue-health'], queryFn: getQueueHealth });

  const [pendingSend, setPendingSend] = useState<'now' | 'scheduled' | null>(null);
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [tone, setTone] = useState<Tone>(user?.settings.tone ?? 'formal');
  /**
   * After a send failure the failure panel takes over. If the user chooses
   * "Edit & retry" we hide the panel, enter edit mode, and let them change the
   * draft or recipient before sending again. Reset when a new send starts so a
   * subsequent failure surfaces again.
   */
  const [dismissFailure, setDismissFailure] = useState(false);

  /* Poll the job while it is queued (the parent only polls 'processing'). */
  const liveQuery = useQuery({
    queryKey: ['job', job.id],
    queryFn: () => getJob(job.id),
    refetchInterval: (query) => (query.state.data?.job.status === 'queued' ? 2000 : false),
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
    onMutate: () => {
      setDismissFailure(false);
    },
    onSuccess: (data, input) => {
      setScheduledAt(data.scheduledAt);
      setPendingSend(input.scheduledAt ? 'scheduled' : 'now');
      void queryClient.invalidateQueries({ queryKey: ['job', job.id] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.code === 'EMAIL_NOT_VERIFIED') {
        toast.error('Verify your email to start sending — check your inbox, or use Resend on the banner above.');
        return;
      }
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

  if (current.status === 'failed' && current.failureCode && !dismissFailure) {
    return (
      <SendFailurePanel
        job={current}
        retrying={sendMutation.isPending}
        onFixEmail={onBack}
        onRetry={() => sendMutation.mutate({})}
        onEditAndRetry={() => {
          setEditSubject(current.draft.subject);
          setEditBody(current.draft.bodyText);
          setEditing(true);
          setDismissFailure(true);
        }}
        onBackToReview={onBack}
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
          Queued with human-like jitter — usually out within a few minutes. We poll the
          status automatically; if it stays here longer, check your Gmail connection or
          server logs.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void liveQuery.refetch()}
            disabled={liveQuery.isFetching}
          >
            <RefreshCw className={cn('size-4', liveQuery.isFetching && 'animate-spin')} />
            Check status
          </Button>
          <Link to="/dashboard" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Go to dashboard
          </Link>
        </div>
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
  const profile = profileQuery.data?.profile;
  const resumeName = profile?.resumeFile ? resumeAttachmentName(profile.fullName) : null;

  const emailVerified = user?.emailVerified ?? false;
  const gmailConnected = user?.gmailConnected ?? false;
  const hasEmailFallback = user?.hasEmailFallback ?? false;
  const hasResume = Boolean(resumeName);
  const senderReady = gmailConnected || hasEmailFallback;

  /**
   * Send is blocked for either transient UI states (busy/editing) or hard
   * prerequisites that would make the backend reject the send anyway. The
   * reason is surfaced next to the button so the user always knows why
   * "Send now" is disabled. In development, a configured Gmail app-password
   * fallback also satisfies the sender requirement so local testing does not
   * require OAuth connection.
   */
  const sendBlockedReason = ((): string | null => {
    if (busy) return 'Drafting the email…';
    if (sendMutation.isPending) return 'Sending…';
    if (editing) return 'Save your edits before sending.';
    if (!emailVerified) return 'Verify your email to send.';
    if (!senderReady) return 'Connect Gmail to send.';
    if (!hasResume) return 'Upload your resume to send.';
    return null;
  })();
  const canSend = !busy && !sendMutation.isPending && !editing && emailVerified && senderReady && hasResume;
  const actionsDisabled = !canSend;

  const footerActions = (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {sendBlockedReason && !sendMutation.isPending && (
        <Mono size="xs" color="warn" className="mr-auto">
          {sendBlockedReason}
        </Mono>
      )}
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
      {canSend && (
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
              <Mono size="xs" color="warn">
                {user?.hasEmailFallback ? 'GMAIL NOT CONNECTED — DEV FALLBACK ACTIVE' : 'GMAIL NOT CONNECTED'}
              </Mono>
              <p className="mt-1 font-sans text-sm font-normal text-text-2-dark">
                {user?.hasEmailFallback
                  ? 'A development Gmail fallback is configured, so you can still send. For production, connect your own account in Settings.'
                  : 'Connect it in Settings before this email can send.'}
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

      {queueHealthQuery.data && !queueHealthQuery.data.healthy && (
        <div className="rounded-card border border-danger/40 bg-ink-2 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <Mono size="xs" color="danger">SEND QUEUE NOT RUNNING</Mono>
              <p className="mt-1 font-sans text-sm font-normal text-text-2-dark">
                The background queue that sends emails is not healthy ({queueHealthQuery.data.mode}
                mode). Emails may stay queued. Ask the admin to restart the server or set
                QUEUE_INLINE=true.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-2 size-4" />
          Back to review
        </Button>
        <Button variant="ghost" size="sm" onClick={onReset}>
          <UploadCloud className="mr-2 size-4" />
          Re-upload screenshot
        </Button>
      </div>

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