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
import { CategoryTile } from '@/components/CategoryTile';
import { Ledger } from '@/components/Ledger';
import { Mono } from '@/components/Mono';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getFunnelAnalytics, getProfile, listApplications, updateApplication } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

const MODULES = [
  { color: 'iris' as const, title: 'Outreach autopilot', description: 'Screenshot to sent email.', icon: Send },
  { color: 'peri' as const, title: 'Wire Board', description: 'Track every stage.', icon: BarChart3 },
  { color: 'deep' as const, title: 'Follow-up engine', description: 'Stops on reply or bounce.', icon: Mail },
  { color: 'orchid' as const, title: 'Template studio', description: 'Save what gets replies.', icon: FileText },
  { color: 'pale' as const, title: 'AI writer', description: 'Tailored to the JD.', icon: Send },
  { color: 'cyan' as const, title: 'Tracking', description: 'Opens, replies, funnel.', icon: BarChart3 },
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
        { label: 'Sent', value: funnel.totals.sent, delta: null },
        { label: 'Opened', value: funnel.totals.opened, delta: null },
        { label: 'Replied', value: funnel.totals.replied, delta: null },
        {
          label: 'Response rate',
          value: `${Math.round(funnel.rates.responseRate * 100)}%`,
          delta: null,
        },
      ]
    : null;

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Mono size="xs" color="fog">
            Dispatches · {applications.length}
          </Mono>
          <h1 className="mt-1 font-display text-[38px] font-normal leading-[0.9] text-text-1">
            {greeting(user?.name?.split(' ')[0])}
            <span className="italic">.</span>
          </h1>
        </div>
        <Link to="/apps/new" className={buttonVariants()}>
          New Dispatch
          <span aria-hidden>→</span>
        </Link>
      </div>

      {/* Stats */}
      {funnelQuery.isPending ? (
        <div className="flex h-[88px] items-stretch divide-x divide-pure/[0.06] border border-border bg-surface">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-1 flex-col justify-center gap-2 px-6">
              <Skeleton className="h-3 w-16 bg-surface-2" />
              <Skeleton className="h-8 w-12 bg-surface-2" />
            </div>
          ))}
        </div>
      ) : stats ? (
        <div className="flex items-stretch divide-x divide-pure/[0.06] border border-border bg-surface">
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-1 flex-col justify-center px-6 py-5">
              <Mono size="xs" color="fog">
                {stat.label}
              </Mono>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-display text-[28px] font-normal leading-[0.95] text-text-1">
                  {stat.value}
                </span>
                {stat.delta && (
                  <Mono size="xs" color={stat.delta >= 0 ? 'cyan' : 'danger'}>
                    {stat.delta >= 0 ? '▲' : '▼'} {Math.abs(stat.delta)}%
                  </Mono>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Chart */}
      {funnelQuery.isPending ? (
        <div className="border border-border bg-surface p-6">
          <Skeleton className="h-5 w-40 bg-surface-2" />
          <Skeleton className="mt-4 h-64 w-full bg-surface-2" />
        </div>
      ) : funnel && funnel.totals.sent > 0 ? (
        <section className="border border-border bg-surface p-6">
          <div className="mb-4">
            <Mono size="xs" color="fog">
              Last 30 days
            </Mono>
            <p className="mt-1 font-sans text-base font-normal text-text-1">Sent per day</p>
          </div>
          <ActivityChart data={funnel.trend} />
        </section>
      ) : null}

      {/* Module tiles */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <Mono size="xs" color="fog">
            Modules
          </Mono>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <CategoryTile
              key={m.title}
              color={m.color}
              title={m.title}
              description={m.description}
              icon={m.icon}
              compact
            />
          ))}
        </div>
      </section>

      {/* Recent dispatches */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <Mono size="xs" color="fog">
              Recent dispatches
            </Mono>
            <p className="mt-1 font-sans text-base font-normal text-text-1">Latest outreach, newest first.</p>
          </div>
          <Link to="/dispatches">
            <Button variant="outline" size="sm">
              Open ledger
              <span aria-hidden>→</span>
            </Button>
          </Link>
        </div>

        {applicationsQuery.isPending ? (
          <div className="space-y-4 border border-border bg-surface p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-1/3 bg-surface-2" />
                <Skeleton className="ml-auto h-4 w-20 bg-surface-2" />
              </div>
            ))}
          </div>
        ) : recent.length === 0 ? (
          <div className="border border-border bg-surface px-6 py-8">
            <p className="font-display text-[38px] font-normal leading-[0.9] text-pure">
              No dispatches yet. <span className="italic">Send</span> the first.
            </p>
            <p className="mt-2 font-sans text-base font-normal text-text-2">
              Upload a job posting — the ledger builds itself.
            </p>
            <Link to="/apps/new" className={cn(buttonVariants({ size: 'sm' }), 'mt-4')}>
              New dispatch
              <span aria-hidden>→</span>
            </Link>
          </div>
        ) : (
          <Ledger applications={recent} onStageChange={(id, stage) => stageMutation.mutate({ id, stage })} />
        )}
      </section>

      {/* Setup checklist */}
      <section className="border border-border bg-surface">
        <div className="border-b border-border px-6 py-4">
          <Mono size="xs" color="fog">
            Setup
          </Mono>
          <p className="mt-1 font-sans text-base font-normal text-text-1">Everything ready to send.</p>
        </div>
        <div className="px-6 py-2">
          {profileQuery.isPending ? (
            <div className="space-y-4 py-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="size-9 bg-surface-2" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3 bg-surface-2" />
                    <Skeleton className="h-3 w-1/2 bg-surface-2" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ol className="divide-y divide-pure/[0.06]">
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
          'flex size-9 shrink-0 items-center justify-center rounded-func border transition-quick',
          done
            ? 'border-ok/30 bg-ok/10 text-ok'
            : 'border-border bg-surface text-text-3',
        )}
      >
        {done ? <CheckCircle2 className="size-4" /> : <Icon className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-sans text-[13.5px] font-normal text-text-1">{title}</p>
        <p className="truncate font-sans text-xs text-text-3">{body ?? ''}</p>
      </div>
      {action && !done ? (
        <Link to={action.to}>
          <Button variant="outline" size="sm">
            {action.label}
            <span aria-hidden>→</span>
          </Button>
        </Link>
      ) : null}
    </li>
  );
}
