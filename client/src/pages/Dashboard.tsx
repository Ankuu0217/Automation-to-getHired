import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  CheckCircle2,
  FileText,
  Mail,
  Send,
  SlidersHorizontal,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { ActivityChart } from '@/components/ActivityChart';
import { EmptyState } from '@/components/EmptyState';
import { Ledger } from '@/components/Ledger';
import { Mono } from '@/components/Mono';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getFunnelAnalytics, getProfile, listApplications, updateApplication } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

const MODULES = [
  { title: 'Outreach autopilot', description: 'Screenshot to sent email.', icon: Send },
  { title: 'Pipeline', description: 'Track every stage.', icon: BarChart3 },
  { title: 'Follow-up engine', description: 'Stops on reply or bounce.', icon: Mail },
  { title: 'Template studio', description: 'Save what gets replies.', icon: FileText },
  { title: 'AI writer', description: 'Tailored to the JD.', icon: Send },
  { title: 'Tracking', description: 'Opens, replies, funnel.', icon: BarChart3 },
] as const;

function greeting(name?: string): string {
  const hour = new Date().getHours();
  const time = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return name ? `Good ${time}, ${name}` : `Good ${time}`;
}

export function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const profileQuery = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const applicationsQuery = useQuery({ queryKey: ['applications'], queryFn: listApplications });
  const funnelQuery = useQuery({ queryKey: ['analytics', 'funnel'], queryFn: getFunnelAnalytics });

  const profile = profileQuery.data?.profile;
  const applications = applicationsQuery.data?.applications ?? [];
  const recent = applications.slice(0, 6);
  const funnel = funnelQuery.data;

  const stageMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: Parameters<typeof updateApplication>[1]['stage'] }) =>
      updateApplication(id, { stage }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['applications'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics', 'funnel'] });
    },
  });

  const stats = funnel
    ? [
        { label: 'Sent', value: funnel.totals.sent },
        { label: 'Opened', value: funnel.totals.opened },
        { label: 'Replied', value: funnel.totals.replied },
        { label: 'Response rate', value: `${Math.round(funnel.rates.responseRate * 100)}%` },
      ]
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Mono size="xs" color="fog">
            Dispatches · {applications.length}
          </Mono>
          <h1 className="mt-1 font-sans text-[38px] font-normal leading-[0.9] text-paper">
            {greeting(user?.name?.split(' ')[0])}
            .
          </h1>
        </div>
        <Link to="/apps/new" className={buttonVariants()}>
          New dispatch
          <span aria-hidden>→</span>
        </Link>
      </div>

      {/* Stats */}
      {funnelQuery.isPending ? (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-graphite bg-graphite sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex h-[88px] min-w-0 flex-col justify-center gap-2 bg-ink-2 px-4">
              <Skeleton className="h-3 w-16 bg-ink-3" />
              <Skeleton className="h-8 w-12 bg-ink-3" />
            </div>
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-graphite bg-graphite sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="flex min-w-0 flex-col justify-center bg-ink-2 px-4 py-4">
              <Mono size="xs" color="fog">
                {stat.label}
              </Mono>
              <span className="mt-1 font-sans text-[28px] font-normal leading-[0.95] text-paper">
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Chart */}
      {funnelQuery.isPending ? (
        <div className="rounded-card border border-graphite bg-ink-2 p-4">
          <Skeleton className="h-5 w-40 bg-ink-3" />
          <Skeleton className="mt-4 h-64 w-full bg-ink-3" />
        </div>
      ) : funnel && funnel.totals.sent > 0 ? (
        <section className="rounded-card border border-graphite bg-ink-2 p-4">
          <div className="mb-4">
            <Mono size="xs" color="fog">
              Last 30 days
            </Mono>
            <p className="mt-1 font-sans text-base font-normal text-paper">Sent per day</p>
          </div>
          <ActivityChart data={funnel.trend} />
        </section>
      ) : null}

      {/* Module tiles */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <Mono size="xs" color="fog">
            Modules
          </Mono>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <div
              key={m.title}
              className="flex items-start gap-3 rounded-card border border-graphite bg-ink-2 p-4"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-btn border border-graphite bg-ink-3 text-text-2-dark">
                <m.icon className="size-4" strokeWidth={1.5} />
              </div>
              <div className="min-w-0">
                <h3 className="font-sans text-sm font-normal text-paper">{m.title}</h3>
                <p className="mt-0.5 font-sans text-xs font-normal text-text-3-dark">{m.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Recent dispatches */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <Mono size="xs" color="fog">
              Recent dispatches
            </Mono>
            <p className="mt-1 font-sans text-base font-normal text-paper">Latest outreach, newest first.</p>
          </div>
          <Link to="/dispatches" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            All dispatches
            <span aria-hidden>→</span>
          </Link>
        </div>

        {applicationsQuery.isPending ? (
          <div className="space-y-4 rounded-card border border-graphite bg-ink-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-1/3 bg-ink-3" />
                <Skeleton className="ml-auto h-4 w-20 bg-ink-3" />
              </div>
            ))}
          </div>
        ) : recent.length === 0 ? (
          <EmptyState
            headline={
              <>
                No dispatches yet. Send the first.
              </>
            }
            description="Upload a job posting — the ledger builds itself."
            action={{ to: '/apps/new', label: 'New dispatch' }}
          />
        ) : (
          <Ledger applications={recent} onStageChange={(id, stage) => stageMutation.mutate({ id, stage })} />
        )}
      </section>

      {/* Setup checklist */}
      <section className="rounded-card border border-graphite bg-ink-2">
        <div className="border-b border-graphite px-4 py-3">
          <Mono size="xs" color="fog">
            Setup
          </Mono>
          <p className="mt-1 font-sans text-base font-normal text-paper">Everything ready to send.</p>
        </div>
        <div className="px-4 py-2">
          {profileQuery.isPending ? (
            <div className="space-y-4 py-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="size-9 bg-ink-3" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3 bg-ink-3" />
                    <Skeleton className="h-3 w-1/2 bg-ink-3" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ol className="divide-y divide-graphite">
              <SetupItem
                done
                icon={CheckCircle2}
                title="Create your account"
                body={user?.email}
              />
              <SetupItem
                done={Boolean(profile?.resumeFile)}
                icon={FileText}
                title="Upload your resume"
                body={profile?.resumeFile?.originalName ?? 'PDF — we prefill skills and summary.'}
                action={{ to: '/onboarding', label: 'Upload' }}
              />
              <SetupItem
                done={(profile?.skills.length ?? 0) > 0}
                icon={SlidersHorizontal}
                title="Review your profile & preferences"
                body={
                  (profile?.skills.length ?? 0) > 0
                    ? `${profile?.skills.length} skills on file`
                    : 'Skills, tone, and daily send cap.'
                }
                action={{ to: '/settings', label: 'Open settings' }}
              />
              <SetupItem
                done={Boolean(user?.gmailConnected)}
                icon={Mail}
                title="Connect Gmail"
                body={user?.gmailConnected ? user.connectedEmail : 'Emails are sent from your own account.'}
                action={{ to: '/settings', label: 'Connect' }}
              />
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}

function SetupItem({
  done,
  icon: Icon,
  title,
  body,
  action,
}: {
  done: boolean;
  icon: React.ElementType;
  title: string;
  body?: string | null;
  action?: { to: string; label: string };
}) {
  return (
    <li className="flex items-center gap-4 py-4 first:pt-2 last:pb-2">
      <div
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-btn border transition-quick',
          done
            ? 'border-ok/30 bg-ok/10 text-ok'
            : 'border-graphite bg-ink-2 text-text-3-dark',
        )}
      >
        {done ? <CheckCircle2 className="size-4" /> : <Icon className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-sans text-[13.5px] font-normal text-paper">{title}</p>
        <p className="truncate font-sans text-xs text-text-3-dark">{body ?? ''}</p>
      </div>
      {action && !done ? (
        <Link to={action.to} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {action.label}
          <span aria-hidden>→</span>
        </Link>
      ) : null}
    </li>
  );
}
