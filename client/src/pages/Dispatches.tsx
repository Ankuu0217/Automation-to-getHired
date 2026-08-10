import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApplicationStage } from '@jobmail/shared';
import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/EmptyState';
import { Ledger } from '@/components/Ledger';
import { Mono } from '@/components/Mono';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError, listApplications, updateApplication } from '@/lib/api';
import { applicationsCsvFilename, buildApplicationsCsv, downloadCsv } from '@/lib/csv';
import {
  categorizeRole,
  groupApplicationsByCategory,
  searchApplications,
  type RoleCategoryId,
} from '@/lib/roleCategory';
import { cn } from '@/lib/utils';

const STAGE_FILTERS: { label: string; value: ApplicationStage | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Applied', value: 'applied' },
  { label: 'HR Screen', value: 'hr_screen' },
  { label: 'Interview', value: 'interview' },
  { label: 'Offer', value: 'offer' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'Ghosted', value: 'ghosted' },
];

function FilterChip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'focus-ring inline-flex items-center rounded-pill border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16px] transition-quick',
        pressed
          ? 'border-lime bg-lime text-ink'
          : 'border-graphite text-text-2-dark hover:bg-ink-3 hover:text-paper',
      )}
    >
      {children}
    </button>
  );
}

export function Dispatches() {
  const queryClient = useQueryClient();
  const applicationsQuery = useQuery({ queryKey: ['applications'], queryFn: listApplications });
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<RoleCategoryId | 'other' | 'all'>('all');
  const [stageFilter, setStageFilter] = useState<ApplicationStage | 'all'>('all');

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

  const categories = useMemo(() => groupApplicationsByCategory(applications), [applications]);

  const filtered = useMemo(() => {
    let list = applications;
    if (categoryFilter !== 'all') {
      list = list.filter((a) => categorizeRole(a.role) === categoryFilter);
    }
    if (stageFilter !== 'all') {
      list = list.filter((a) => a.stage === stageFilter);
    }
    list = searchApplications(list, search);
    return list;
  }, [applications, categoryFilter, stageFilter, search]);

  const clearFilters = () => {
    setSearch('');
    setCategoryFilter('all');
    setStageFilter('all');
  };

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

      {/* Search */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, role, recruiter…"
          aria-label="Search dispatches"
          className="max-w-[320px]"
        />
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={filtered.length === 0}
          onClick={() => downloadCsv(buildApplicationsCsv(filtered), applicationsCsvFilename())}
        >
          Export CSV
        </Button>
      </div>

      {/* Category tabs (dynamic) */}
      {applications.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip pressed={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')}>
            All · {applications.length}
          </FilterChip>
          {categories.map((c) => (
            <FilterChip
              key={c.categoryId}
              pressed={categoryFilter === c.categoryId}
              onClick={() => setCategoryFilter(c.categoryId)}
            >
              {c.label} · {c.count}
            </FilterChip>
          ))}
        </div>
      )}

      {/* Stage filters */}
      {applications.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {STAGE_FILTERS.map((f) => (
            <FilterChip
              key={f.value}
              pressed={stageFilter === f.value}
              onClick={() => setStageFilter(f.value)}
            >
              {f.label}
            </FilterChip>
          ))}
        </div>
      )}

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
          headline={<>No dispatches yet. Send the first.</>}
          description="Upload a job posting and the first dispatch drafts itself."
          action={{ to: '/apps/new', label: 'New dispatch' }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          headline={<>Nothing matches.</>}
          description="Try a different search, category, or stage filter."
        >
          <Button variant="outline" size="sm" className="mt-6" onClick={clearFilters}>
            Clear filters
          </Button>
        </EmptyState>
      ) : (
        <Ledger
          applications={filtered}
          onStageChange={(id, stage) => stageMutation.mutate({ id, stage })}
        />
      )}
    </div>
  );
}
