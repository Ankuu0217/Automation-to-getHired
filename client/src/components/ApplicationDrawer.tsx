import type {
  ApplicationDetailResponse,
  ApplicationStage,
  ApplicationUpdateInput,
} from '@jobmail/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Clock,
  Loader2,
  MailOpen,
  MailWarning,
  Reply,
  Send,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Mono } from '@/components/Mono';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  ApiRequestError,
  getApplication,
  markApplicationReplied,
  updateApplication,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  ALL_STAGES,
  buildTimeline,
  emailKindLabel,
  formatDateTime,
  formatRelativeTime,
  stageBadgeVariant,
  stageLabel,
  type TimelineKind,
} from '@/pages/pipelineUtils';

/* 6px dots, mirroring the StatusLabel signal logic: neutral solid = in
 * flight, hollow lime = engaged, ok = won, danger = lost. No fills. */
const TIMELINE_DOT: Record<TimelineKind, string> = {
  sent: 'bg-text-2-dark',
  opened: 'border border-lime bg-transparent',
  replied: 'bg-ok',
  bounced: 'bg-danger',
};

/** ISO (or null) → datetime-local input value in the viewer's timezone. */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function EmailThread({ application }: { application: ApplicationDetailResponse }) {
  if (application.emails.length === 0) {
    return <p className="font-sans text-sm text-text-3-dark">No emails sent yet.</p>;
  }
  return (
    <ol className="space-y-3">
      {application.emails.map((email, index) => (
        <li
          key={`${email.messageId ?? 'draft'}-${index}`}
          className="rounded-card border border-graphite bg-ink"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-graphite px-4 py-3">
            <Badge variant={email.kind === 'initial' ? 'default' : 'secondary'}>
              {emailKindLabel(email.kind)}
            </Badge>
            <p className="min-w-0 flex-1 truncate font-sans text-sm font-normal text-paper">
              {email.subject || '(no subject)'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-3 font-mono text-xs uppercase tracking-[0.016em] text-text-3-dark">
            {email.sentAt ? (
              <span className="inline-flex items-center gap-1">
                <Send className="size-3" /> Sent {formatDateTime(email.sentAt)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" /> Scheduled — not sent yet
              </span>
            )}
            {email.openedAt && (
              <span className="inline-flex items-center gap-1 text-lime">
                <MailOpen className="size-3" /> Opened {formatDateTime(email.openedAt)}
              </span>
            )}
            {email.repliedAt && (
              <span className="inline-flex items-center gap-1 text-ok">
                <Reply className="size-3" /> Replied {formatDateTime(email.repliedAt)}
              </span>
            )}
            {email.bouncedAt && (
              <span className="inline-flex items-center gap-1 text-danger">
                <MailWarning className="size-3" /> Bounced {formatDateTime(email.bouncedAt)}
              </span>
            )}
          </div>
          {email.bodyText && (
            <p className="whitespace-pre-wrap px-4 py-3 font-sans text-sm leading-relaxed text-text-2-dark">
              {email.bodyText}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

function EventsTimeline({ application }: { application: ApplicationDetailResponse }) {
  const timeline = buildTimeline(application);
  if (timeline.length === 0) {
    return <p className="font-sans text-sm text-text-3-dark">No activity yet.</p>;
  }
  return (
    <ol className="relative space-y-4 border-l border-graphite pl-5">
      {timeline.map((entry) => (
        <li key={`${entry.kind}-${entry.at}`} className="relative flex items-center gap-3">
          <span
            className={cn(
              'absolute -left-[23px] size-1.5 rounded-full',
              TIMELINE_DOT[entry.kind],
            )}
          />
          <p className="min-w-0 flex-1 truncate font-mono text-xs uppercase tracking-[0.016em] text-paper">
            {entry.label}
          </p>
          <span
            className="shrink-0 font-mono text-xs uppercase tracking-[0.016em] text-text-3-dark"
            title={formatDateTime(entry.at)}
          >
            {formatRelativeTime(entry.at)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function DrawerSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-4 w-24 bg-ink-3" />
        <Skeleton className="h-28 w-full bg-ink-3" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-24 bg-ink-3" />
        <Skeleton className="h-20 w-full bg-ink-3" />
        <Skeleton className="h-20 w-full bg-ink-3" />
      </div>
    </div>
  );
}

interface ApplicationDrawerProps {
  applicationId: string | null;
  onClose: () => void;
}

export function ApplicationDrawer({ applicationId, onClose }: ApplicationDrawerProps) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ['application', applicationId],
    queryFn: () => getApplication(applicationId as string),
    enabled: applicationId !== null,
  });

  const application = detailQuery.data?.application ?? null;

  /* Notes draft, re-synced whenever a different application loads. */
  const [notes, setNotes] = useState('');
  useEffect(() => {
    setNotes(application?.notes ?? '');
  }, [application?.id, application?.notes]);

  /* Interview draft (Phase 3), re-synced the same way. */
  const [interviewAtLocal, setInterviewAtLocal] = useState('');
  const [interviewNote, setInterviewNote] = useState('');
  useEffect(() => {
    setInterviewAtLocal(isoToLocalInput(application?.interviewAt ?? null));
    setInterviewNote(application?.interviewNote ?? '');
  }, [application?.id, application?.interviewAt, application?.interviewNote]);

  const onUpdated = (data: { application: ApplicationDetailResponse }) => {
    queryClient.setQueryData(['application', applicationId], data);
    void queryClient.invalidateQueries({ queryKey: ['applications'] });
  };

  const onMutationError = (fallback: string) => (error: unknown) => {
    toast.error(error instanceof ApiRequestError ? error.message : fallback);
  };

  const stageMutation = useMutation({
    mutationFn: (stage: ApplicationStage) => updateApplication(applicationId as string, { stage }),
    onSuccess: (data) => {
      onUpdated(data);
      toast.success(`Moved to ${stageLabel(data.application.stage)}.`);
    },
    onError: onMutationError('Could not update the stage.'),
  });

  const notesMutation = useMutation({
    mutationFn: () => updateApplication(applicationId as string, { notes }),
    onSuccess: (data) => {
      onUpdated(data);
      toast.success('Notes saved.');
    },
    onError: onMutationError('Could not save the notes.'),
  });

  const interviewMutation = useMutation({
    mutationFn: (input: ApplicationUpdateInput) =>
      updateApplication(applicationId as string, input),
    onSuccess: (data) => {
      onUpdated(data);
      toast.success(
        data.application.interviewAt ? 'Interview saved.' : 'Interview date cleared.',
      );
    },
    onError: onMutationError('Could not save the interview details.'),
  });

  const repliedMutation = useMutation({
    mutationFn: () => markApplicationReplied(applicationId as string),
    onSuccess: (data) => {
      onUpdated(data);
      toast.success('Marked as replied.');
    },
    onError: onMutationError('Could not mark as replied.'),
  });

  const alreadyReplied = application?.emails.some((e) => e.repliedAt !== null) ?? false;
  const notesDirty = application !== null && notes !== application.notes;
  const interviewDirty =
    application !== null &&
    (interviewAtLocal !== isoToLocalInput(application.interviewAt) ||
      interviewNote !== (application.interviewNote ?? ''));
  const reminderScheduled =
    application?.interviewAt != null &&
    new Date(application.interviewAt).getTime() > Date.now();

  const saveInterview = () => {
    interviewMutation.mutate({
      interviewAt: interviewAtLocal ? new Date(interviewAtLocal).toISOString() : null,
      interviewNote: interviewNote.trim() ? interviewNote : null,
    });
  };

  const clearInterviewDate = () => {
    setInterviewAtLocal('');
    if (application?.interviewAt) interviewMutation.mutate({ interviewAt: null });
  };

  return (
    <Sheet
      open={applicationId !== null}
      onOpenChange={(open) => !open && onClose()}
      aria-label="Application details"
    >
      <SheetHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <SheetTitle className="truncate">
              {detailQuery.isPending ? (
                <Skeleton className="h-5 w-40 bg-ink-3" />
              ) : (
                (application?.company ?? 'Unknown company')
              )}
            </SheetTitle>
            <SheetDescription className="truncate">
              {application?.role ?? ''}
              {application?.hrName ? ` · ${application.hrName}` : ''}
              {application ? ` · ${application.hrEmail}` : ''}
            </SheetDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {application && (
              <Badge variant={stageBadgeVariant(application.stage)}>
                {stageLabel(application.stage)}
              </Badge>
            )}
            <SheetClose onClose={onClose} />
          </div>
        </div>
      </SheetHeader>

      <SheetBody className="space-y-8">
        {detailQuery.isPending ? (
          <DrawerSkeleton />
        ) : detailQuery.isError || !application ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertTriangle className="size-6 text-danger" />
            <p className="font-sans text-sm text-text-2-dark">Could not load this application.</p>
            <Button variant="outline" size="sm" onClick={() => void detailQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            {/* Actions */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-44 space-y-1.5">
                <Label htmlFor="drawer-stage">Stage</Label>
                <Select
                  id="drawer-stage"
                  value={application.stage}
                  disabled={stageMutation.isPending}
                  onChange={(e) => stageMutation.mutate(e.target.value as ApplicationStage)}
                >
                  {ALL_STAGES.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.label}
                    </option>
                  ))}
                </Select>
              </div>
              {!alreadyReplied && (
                <Button
                  variant="outline"
                  onClick={() => repliedMutation.mutate()}
                  disabled={repliedMutation.isPending}
                >
                  {repliedMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Reply className="size-4" />}
                  Mark as replied
                </Button>
              )}
            </div>

            {/* Interview (Phase 3) — revealed while the stage is Interview. */}
            {application.stage === 'interview' && (
              <>
                <Separator />
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="drawer-interview-at">Interview</Label>
                    {interviewMutation.isPending && (
                      <Loader2 className="size-3.5 animate-spin text-text-3-dark" />
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      id="drawer-interview-at"
                      type="datetime-local"
                      className="w-56"
                      value={interviewAtLocal}
                      onChange={(e) => setInterviewAtLocal(e.target.value)}
                    />
                    {interviewAtLocal !== '' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={interviewMutation.isPending}
                        onClick={clearInterviewDate}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  {reminderScheduled && (
                    <Mono size="xs" color="fog" className="block">
                      Reminder 24h before
                    </Mono>
                  )}
                  <Textarea
                    id="drawer-interview-note"
                    aria-label="Interview note"
                    rows={3}
                    placeholder="Panel names, meeting link, prep pointers…"
                    value={interviewNote}
                    onChange={(e) => setInterviewNote(e.target.value)}
                  />
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!interviewDirty || interviewMutation.isPending}
                      onClick={saveInterview}
                    >
                      Save interview
                    </Button>
                  </div>
                </section>
              </>
            )}

            <Separator />

            {/* Email thread */}
            <section className="space-y-3">
              <h3 className="font-sans text-base font-normal text-paper">Email thread</h3>
              <EmailThread application={application} />
            </section>

            <Separator />

            {/* Events timeline */}
            <section className="space-y-3">
              <h3 className="font-sans text-base font-normal text-paper">Activity</h3>
              <EventsTimeline application={application} />
            </section>

            <Separator />

            {/* Notes */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="drawer-notes">Notes</Label>
                {notesMutation.isPending && (
                  <Loader2 className="size-3.5 animate-spin text-text-3-dark" />
                )}
              </div>
              <Textarea
                id="drawer-notes"
                rows={4}
                placeholder="Interview prep, salary expectations, referrals…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!notesDirty || notesMutation.isPending}
                  onClick={() => notesMutation.mutate()}
                >
                  Save notes
                </Button>
              </div>
            </section>
          </>
        )}
      </SheetBody>
    </Sheet>
  );
}
