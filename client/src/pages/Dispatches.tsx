import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApplicationStage } from '@jobmail/shared';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/EmptyState';
import { Ledger } from '@/components/Ledger';
import { Mono } from '@/components/Mono';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError, listApplications, updateApplication } from '@/lib/api';
import { cn } from '@/lib/utils';

const FILTERS: { label: string; value: ApplicationStage | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Applied', value: 'applied' },
  { label: 'HR Screen', value: 'hr_screen' },
  { label: 'Interview', value: 'interview' },
  { label: 'Offer', value: 'offer' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'Ghosted', value: 'ghosted' },
];

export function Dispatches() {
  const queryClient = useQueryClient();
  const applicationsQuery = useQuery({ queryKey: ['applications'], queryFn: listApplications });
  const [filter, setFilter] = useState<'all' | ApplicationStage>('all');

  const stageMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: ApplicationStage }) =>
      updateApplication(id, { stage }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['applications'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics', 'funnel'] });
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not update the stage.');
    },
  });

  const applications = applicationsQuery.data?.applications ?? [];
  const filtered =
    filter === 'all'
      ? applications
      : applications.filter((a) => a.stage === filter);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Mono size="xs" color="fog">
            Dispatches
          </Mono>
          <h1 className="mt-1 font-sans text-heading font-normal text-paper">
            Every dispatch.
          </h1>
        </div>
        <Link to="/apps/new" className={buttonVariants()}>
          New dispatch
          <span aria-hidden>→</span>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              'focus-ring inline-flex items-center rounded-pill border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16px] transition-quick',
              filter === f.value
                ? 'border-lime bg-lime text-ink'
                : 'border-graphite text-text-2-dark hover:bg-ink-3 hover:text-paper',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {applicationsQuery.isPending ? (
        <div className="space-y-4 rounded-card border border-graphite bg-ink-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-1/3 bg-ink-3" />
              <Skeleton className="ml-auto h-4 w-20 bg-ink-3" />
            </div>
          ))}
        </div>
      ) : applications.length === 0 ? (
        <EmptyState
          headline={
            <>
              No dispatches yet. Send the first.
            </>
          }
          description="Upload a job posting and the first dispatch drafts itself."
          action={{ to: '/apps/new', label: 'New dispatch' }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          headline={
            <>
              Nothing in this stage.
            </>
          }
          description={
            <>
              No dispatches match the current filter.
              <Button
                variant="outline"
                size="sm"
                className="mt-4 flex"
                onClick={() => setFilter('all')}
              >
                Show all
              </Button>
            </>
          }
        />
      ) : (
        <Ledger
          applications={filtered}
          onStageChange={(id, stage) => stageMutation.mutate({ id, stage })}
        />
      )}
    </div>
  );
}
