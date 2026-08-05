import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensors,
  useSensor,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { ApplicationListResponse, ApplicationStage, ApplicationSummary } from '@jobmail/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailOpen, MailWarning, Plus, Reply } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { ApplicationDrawer } from '@/components/ApplicationDrawer';
import { EmptyState } from '@/components/EmptyState';
import { Mono } from '@/components/Mono';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError, listApplications, updateApplication } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  GHOSTED_STAGE,
  PIPELINE_STAGES,
  stageLabel,
  type StageMeta,
} from '@/pages/pipelineUtils';

function dispatchNumber(index: number) {
  return `DSP-${String(index + 1).padStart(3, '0')}`;
}

function buildDispatchMap(applications: ApplicationSummary[]) {
  const sorted = [...applications].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const map = new Map<string, string>();
  sorted.forEach((app, i) => map.set(app.id, dispatchNumber(i)));
  return map;
}

function isGhosted(application: ApplicationSummary): boolean {
  if (application.stage === 'ghosted') return true;
  if (application.daysSinceSent === null) return false;
  return application.daysSinceSent >= 14 && !application.lastEmail?.repliedAt;
}

/* ── Card ───────────────────────────────────────────────────────── */

function CardBody({
  application,
  dispatchCode,
}: {
  application: ApplicationSummary;
  dispatchCode: string;
}) {
  const followUpDays = application.nextFollowUpAt
    ? Math.ceil(
        (new Date(application.nextFollowUpAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      )
    : null;
  const lastEmail = application.lastEmail;

  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-sans text-sm text-paper">
          {application.company ?? 'Unknown company'}
        </p>
      </div>
      <p className="mt-0.5 truncate font-sans text-[13px] font-normal text-text-2-dark">
        {application.role ?? 'Role unknown'}
      </p>
      <p className="mt-1 truncate font-mono text-xs normal-case tracking-[0.016em] text-text-3-dark">
        {application.hrName ? `${application.hrName} · ` : ''}
        {application.hrEmail}
      </p>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mono size="xs" color="fog">
            {dispatchCode}
          </Mono>
          {followUpDays !== null && (
            <Mono size="xs" color="cyan">
              {followUpDays <= 0 ? 'F-UP·DUE' : `F-UP·${followUpDays}D`}
            </Mono>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {lastEmail?.bouncedAt && (
            <span title="Bounced" className="text-danger">
              <MailWarning className="size-3.5" />
            </span>
          )}
          {lastEmail?.openedAt && (
            <span title="Opened" className="text-lime">
              <MailOpen className="size-3.5" />
            </span>
          )}
          {lastEmail?.repliedAt && (
            <span title="Replied" className="text-ok">
              <Reply className="size-3.5" />
            </span>
          )}
        </div>
      </div>
    </>
  );
}

function DraggableCard({
  application,
  dispatchCode,
  onOpen,
}: {
  application: ApplicationSummary;
  dispatchCode: string;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: application.id });
  const ghosted = isGhosted(application);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      aria-label={`${application.company ?? 'Application'} — ${stageLabel(application.stage)}. Press Enter for details, Space to pick up and move.`}
      onClick={() => onOpen(application.id)}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.key === 'Enter' && !isDragging) onOpen(application.id);
      }}
      className={cn(
        'focus-ring cursor-grab touch-pan-y rounded-card border border-graphite bg-ink-2 p-4 transition-quick hover:border-text-3-dark active:cursor-grabbing',
        ghosted && 'border-dashed',
        isDragging && 'border-lime bg-ink-3 opacity-40',
      )}
    >
      <CardBody application={application} dispatchCode={dispatchCode} />
    </div>
  );
}

/* ── Column ─────────────────────────────────────────────────────── */

function StageColumn({
  stage,
  index,
  applications,
  dispatchMap,
  dimmed = false,
  onOpen,
}: {
  stage: StageMeta;
  index: number;
  applications: ApplicationSummary[];
  dispatchMap: Map<string, string>;
  dimmed?: boolean;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <section
      aria-label={`${stage.label} column`}
      className={cn(
        'flex w-[300px] shrink-0 flex-col rounded-card border border-graphite bg-ink p-3',
        dimmed && 'opacity-70',
      )}
    >
      <p className="mb-3 px-1 font-mono text-[13px] uppercase tracking-[-0.02em] text-text-2-dark">
        {String(index + 1).padStart(2, '0')} {stage.label} · {applications.length}
      </p>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-40 flex-1 flex-col gap-2.5 transition-quick',
          isOver && 'before:block before:h-0.5 before:bg-lime before:content-[""]',
        )}
      >
        {applications.map((application) => (
          <DraggableCard
            key={application.id}
            application={application}
            dispatchCode={dispatchMap.get(application.id) ?? 'DSP-000'}
            onOpen={onOpen}
          />
        ))}
        {applications.length === 0 && (
          <p className="px-2 py-6 text-center font-mono text-[10px] uppercase tracking-[0.16px] text-text-3-dark">
            Drop cards here
          </p>
        )}
      </div>
    </section>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {PIPELINE_STAGES.map((stage) => (
        <div
          key={stage.id}
          className="w-[300px] shrink-0 rounded-card border border-graphite bg-ink p-3"
        >
          <div className="mb-3 px-1">
            <Skeleton className="h-3.5 w-28 bg-ink-3" />
          </div>
          <div className="space-y-2.5">
            <Skeleton className="h-24 w-full bg-ink-3 rounded-card" />
            <Skeleton className="h-24 w-full bg-ink-3 rounded-card" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────── */

export function Pipeline() {
  const queryClient = useQueryClient();
  const applicationsQuery = useQuery({ queryKey: ['applications'], queryFn: listApplications });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    /* Space picks up / drops; Enter is left free for the card's open-details action. */
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  const stageMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: ApplicationStage }) =>
      updateApplication(id, { stage }),
    onMutate: async ({ id, stage }) => {
      await queryClient.cancelQueries({ queryKey: ['applications'] });
      const previous = queryClient.getQueryData<ApplicationListResponse>(['applications']);
      queryClient.setQueryData<ApplicationListResponse>(['applications'], (old) =>
        old ? { applications: old.applications.map((a) => (a.id === id ? { ...a, stage } : a)) } : old,
      );
      return { previous };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['application', data.application.id], data);
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['applications'], context.previous);
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not update the stage.');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['applications'] });
    },
  });

  const applications = useMemo(
    () => applicationsQuery.data?.applications ?? [],
    [applicationsQuery.data],
  );
  const dispatchMap = useMemo(() => buildDispatchMap(applications), [applications]);

  const byStage = useMemo(() => {
    const map = new Map<ApplicationStage, ApplicationSummary[]>();
    for (const application of applications) {
      const list = map.get(application.stage) ?? [];
      list.push(application);
      map.set(application.stage, list);
    }
    return map;
  }, [applications]);

  const columns = useMemo(
    () =>
      (byStage.get('ghosted')?.length ?? 0) > 0
        ? [...PIPELINE_STAGES, GHOSTED_STAGE]
        : PIPELINE_STAGES,
    [byStage],
  );

  const activeApplication = activeId
    ? (applications.find((a) => a.id === activeId) ?? null)
    : null;

  const onDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const application = applications.find((a) => a.id === active.id);
    const stage = over.id as ApplicationStage;
    if (application && application.stage !== stage) {
      stageMutation.mutate({ id: application.id, stage });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Mono size="xs" color="fog">
            Applications
          </Mono>
          <h1 className="mt-1 font-sans text-heading font-normal text-paper">
            The pipeline.
          </h1>
        </div>
        <Link to="/apps/new" className={buttonVariants()}>
          <Plus className="size-4" />
          New dispatch
        </Link>
      </div>

      {applicationsQuery.isPending ? (
        <BoardSkeleton />
      ) : applicationsQuery.isError ? (
        <EmptyState
          className="border-danger/30"
          headline={
            <>
              The pipeline refused to load.
            </>
          }
          description={
            <>
              Check the connection, then pull the board again.
              <Button
                variant="outline"
                size="sm"
                className="mt-4 flex"
                onClick={() => void applicationsQuery.refetch()}
              >
                Try again
              </Button>
            </>
          }
        />
      ) : applications.length === 0 ? (
        <EmptyState
          headline={
            <>
              No dispatches yet. Send the first.
            </>
          }
          description="Send your first outreach from a job-post screenshot and it lands here — tracked from Applied to Offer."
          action={{ to: '/apps/new', label: 'New dispatch' }}
        />
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-4">
            {columns.map((stage, index) => (
              <StageColumn
                key={stage.id}
                stage={stage}
                index={index}
                applications={byStage.get(stage.id) ?? []}
                dispatchMap={dispatchMap}
                dimmed={stage.id === 'ghosted'}
                onOpen={setSelectedId}
              />
            ))}
          </div>
          <DragOverlay>
            {activeApplication && (
              <div className="w-[300px] rotate-2 rounded-card border border-lime bg-ink-3 p-4">
                <CardBody
                  application={activeApplication}
                  dispatchCode={dispatchMap.get(activeApplication.id) ?? 'DSP-000'}
                />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      <ApplicationDrawer applicationId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
