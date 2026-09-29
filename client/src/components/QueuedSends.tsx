import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JobPostSummary } from '@jobmail/shared';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { Mono } from '@/components/Mono';
import { StatusLabel } from '@/components/StatusLabel';
import { Button, buttonVariants } from '@/components/ui/button';
import { ApiRequestError, cancelJobSend, listJobs } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

/**
 * Emails that are not in the ledger yet: queued (going out now or scheduled) and
 * failed sends. A dispatch only becomes an Application once Gmail accepted it,
 * so without this panel a queued or failed email would be invisible.
 * Renders nothing when there is nothing in flight.
 */
export function QueuedSends() {
  const queryClient = useQueryClient();
  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: listJobs,
    // Fast while something is on its way out, idle otherwise.
    refetchInterval: (q) => (q.state.data?.jobs.some((j) => j.status === 'queued') ? 3000 : false),
  });

  const jobs = jobsQuery.data?.jobs ?? [];
  const queued = jobs.filter((j) => j.status === 'queued');
  const failed = jobs.filter((j) => j.status === 'failed' && j.failureCode !== null);

  // A queued email that disappears from the list was sent — refresh the ledger.
  const prevQueued = useRef(0);
  useEffect(() => {
    if (queued.length < prevQueued.current) {
      void queryClient.invalidateQueries({ queryKey: ['applications'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics', 'funnel'] });
    }
    prevQueued.current = queued.length;
  }, [queued.length, queryClient]);

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelJobSend(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast.success('Send cancelled — the draft is saved.');
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not cancel — it may already be sending.');
    },
  });

  if (queued.length === 0 && failed.length === 0) return null;

  return (
    <section className="rounded-card border border-graphite bg-ink-2" aria-label="Queued and failed sends">
      {queued.length > 0 && (
        <div>
          <div className="flex items-center gap-3 border-b border-graphite px-4 py-3">
            <Mono size="xs" color="fog">In flight · {queued.length}</Mono>
          </div>
          <ul className="divide-y divide-graphite">
            {queued.map((job) => (
              <QueuedRow
                key={job.id}
                job={job}
                cancelling={cancelMutation.isPending && cancelMutation.variables === job.id}
                onCancel={() => cancelMutation.mutate(job.id)}
              />
            ))}
          </ul>
        </div>
      )}
      {failed.length > 0 && (
        <div className={queued.length > 0 ? 'border-t border-graphite' : ''}>
          <div className="flex items-center gap-3 border-b border-graphite px-4 py-3">
            <Mono size="xs" color="danger">Failed · {failed.length}</Mono>
          </div>
          <ul className="divide-y divide-graphite">
            {failed.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-sans text-sm text-paper">{title(job)}</p>
                  <p className="mt-0.5 line-clamp-2 font-sans text-xs text-text-2-dark">
                    {job.error ?? 'The email could not be sent.'}
                  </p>
                </div>
                <Link to={`/apps/new?job=${job.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  Fix &amp; retry
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function title(job: JobPostSummary): string {
  const parts = [job.company, job.role].filter(Boolean);
  return parts.length > 0 ? parts.join(' — ') : (job.hrEmail ?? 'Untitled dispatch');
}

function QueuedRow({
  job,
  cancelling,
  onCancel,
}: {
  job: JobPostSummary;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const dueMs = job.sendAt ? new Date(job.sendAt).getTime() : null;
  const scheduled = dueMs !== null && dueMs - Date.now() > 60_000;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-sans text-sm text-paper">{title(job)}</p>
        {job.hrEmail && <p className="mt-0.5 truncate font-sans text-xs text-text-2-dark">To {job.hrEmail}</p>}
      </div>
      <div className="flex items-center gap-3">
        <StatusLabel status="queued" />
        <Mono size="xs" color="fog">
          {scheduled && job.sendAt ? formatDateTime(job.sendAt) : 'Sending now'}
        </Mono>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={cancelling}>
          Cancel
        </Button>
      </div>
    </li>
  );
}
