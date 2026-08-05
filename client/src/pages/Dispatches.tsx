import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApplicationStage } from '@jobmail/shared';
import { Link } from 'react-router-dom';
import { useState } from 'react';

import { Ledger } from '@/components/Ledger';
import { Mono } from '@/components/Mono';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { listApplications, updateApplication } from '@/lib/api';
import { cn } from '@/lib/utils';

const FILTERS: { label: string; value: ApplicationStage | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Applied', value: 'applied' },
  { label: 'HR Screen', value: 'hr_screen' },
  { label: 'Interview', value: 'interview' },
  { label: 'Offer', value: 'offer' },
  { label: 'Rejected', value: 'rejected' },
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
          <h1 className="mt-1 font-display text-[38px] font-normal leading-[0.9] text-text-1">
            The <span className="italic">Ledger</span>
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
            onClick={() => setFilter(f.value)}
            className={cn(
              'inline-flex items-center rounded-pill border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16px] transition-quick',
              filter === f.value
                ? 'border-pure bg-pure text-void'
                : 'border-pure/20 bg-transparent text-text-2 hover:border-pure/40 hover:text-pure',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {applicationsQuery.isPending ? (
        <div className="space-y-4 border border-border bg-surface p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-1/3 bg-surface-2" />
              <Skeleton className="ml-auto h-4 w-20 bg-surface-2" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-border bg-surface px-6 py-8">
          <p className="font-display text-[38px] font-normal leading-[0.9] text-pure">
            No dispatches match. <span className="italic">Send</span> the first.
          </p>
          <p className="mt-2 font-sans text-base font-normal text-text-2">
            Upload a job posting and the ledger builds itself.
          </p>
          <Link to="/apps/new" className={cn(buttonVariants({ size: 'sm' }), 'mt-4')}>
            New dispatch
            <span aria-hidden>→</span>
          </Link>
        </div>
      ) : (
        <Ledger
          applications={filtered}
          onStageChange={(id, stage) => stageMutation.mutate({ id, stage })}
        />
      )}
    </div>
  );
}
