import type { FunnelTrendPoint, FunnelTotals, PerTemplateStats } from '@jobmail/shared';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Mail, Send } from 'lucide-react';
import { Link } from 'react-router-dom';

import { ActivityChart } from '@/components/ActivityChart';
import { CategoryTile } from '@/components/CategoryTile';
import { Mono } from '@/components/Mono';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getFunnelAnalytics, listTemplates } from '@/lib/api';
import { cn } from '@/lib/utils';

const FUNNEL_STEPS: { key: keyof FunnelTotals; label: string }[] = [
  { key: 'sent', label: 'Sent' },
  { key: 'opened', label: 'Opened' },
  { key: 'replied', label: 'Replied' },
  { key: 'interviews', label: 'Interviews' },
  { key: 'offers', label: 'Offers' },
];

function formatDateRange(trend: FunnelTrendPoint[]): string {
  if (trend.length === 0) return '';
  const first = new Date(`${trend[0].date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const last = new Date(`${trend[trend.length - 1].date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return `${first} – ${last}`;
}

function rateOf(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;
}

/* ── Funnel bars ─────────────────────────────────────────────────────────── */

function FunnelBars({ totals }: { totals: FunnelTotals }) {
  const max = Math.max(totals.sent, 1);

  return (
    <section className="border border-border bg-surface p-6">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <Mono size="xs" color="fog">
            Funnel
          </Mono>
          <p className="mt-1 font-sans text-base font-normal text-text-1">Application-level conversion.</p>
        </div>
        <Mono size="xs" color="fog">
          Sent · {totals.sent}
        </Mono>
      </div>

      <div className="space-y-4">
        {FUNNEL_STEPS.map((step, index) => {
          const value = totals[step.key];
          const pct = (value / max) * 100;
          const prev = totals[FUNNEL_STEPS[index - 1]?.key ?? step.key];
          const conversion = index === 0 ? null : rateOf(value, prev);
          return (
            <div key={step.key} className="space-y-1.5">
              <div className="flex items-center justify-between font-sans text-sm text-text-1">
                <span>{step.label}</span>
                <div className="flex items-center gap-3">
                  {conversion !== null && (
                    <Mono size="xs" color="cyan">
                      {conversion} of prev
                    </Mono>
                  )}
                  <Mono size="xs" color="pure" className="min-w-[2ch] text-right">
                    {value}
                  </Mono>
                </div>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-pill border border-border bg-background">
                <div
                  className="h-full rounded-pill bg-cyan transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.max(pct, 2)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ── Per-template ledger ─────────────────────────────────────────────────── */

function TemplateLedger({
  stats,
  templates,
}: {
  stats: PerTemplateStats[];
  templates: { id: string; tone: string }[];
}) {
  return (
    <section className="border border-border bg-surface">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-end justify-between">
          <div>
            <Mono size="xs" color="fog">
              Templates
            </Mono>
            <p className="mt-1 font-sans text-base font-normal text-text-1">A/B reply-rate ledger.</p>
          </div>
          <Mono size="xs" color="fog">
            {stats.length} total
          </Mono>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="px-6 py-3 text-left">
                <Mono size="xs" color="fog">
                  Template
                </Mono>
              </th>
              <th className="px-6 py-3 text-left">
                <Mono size="xs" color="fog">
                  Tone
                </Mono>
              </th>
              <th className="px-6 py-3 text-right">
                <Mono size="xs" color="fog">
                  Sent
                </Mono>
              </th>
              <th className="px-6 py-3 text-right">
                <Mono size="xs" color="fog">
                  Opened
                </Mono>
              </th>
              <th className="px-6 py-3 text-right">
                <Mono size="xs" color="fog">
                  Replied
                </Mono>
              </th>
              <th className="px-6 py-3 text-right">
                <Mono size="xs" color="fog">
                  Reply rate
                </Mono>
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.map((t, i) => {
              const tone = templates.find((x) => x.id === t.templateId)?.tone ?? '—';
              const reply = t.sent === 0 ? '—' : `${Math.round(t.replyRate * 100)}%`;
              return (
                <tr
                  key={t.templateId}
                  className={cn(
                    'transition-quick',
                    i !== stats.length - 1 && 'border-b border-border',
                    'hover:bg-surface-2',
                  )}
                >
                  <td className="px-6 py-3.5">
                    <p className="font-sans text-[15px] font-normal text-text-1">{t.name}</p>
                  </td>
                  <td className="px-6 py-3.5">
                    <Mono size="xs" color="ash" className="capitalize">
                      {tone}
                    </Mono>
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <Mono size="xs" color="ash">
                      {t.sent}
                    </Mono>
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <Mono size="xs" color="ash">
                      {t.opened}
                    </Mono>
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <Mono size="xs" color="ash">
                      {t.replied}
                    </Mono>
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <Mono size="xs" color={reply === '—' ? 'fog' : 'cyan'}>
                      {reply}
                    </Mono>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ── Empty state ─────────────────────────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="border border-border bg-surface px-6 py-10">
      <p className="font-display text-[38px] font-normal leading-[0.9] text-pure">
        No dispatches yet. <span className="italic">Send</span> the first.
      </p>
      <p className="mt-2 max-w-md font-sans text-base font-normal text-text-2">
        Once outreach is in flight, opens, replies, interviews, and offers appear here.
      </p>
      <Link to="/apps/new" className={cn(buttonVariants({ size: 'sm' }), 'mt-6')}>
        <Mail className="size-4" />
        New dispatch
        <span aria-hidden>→</span>
      </Link>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export function Analytics() {
  const funnelQuery = useQuery({ queryKey: ['analytics', 'funnel'], queryFn: getFunnelAnalytics });
  const templatesQuery = useQuery({ queryKey: ['templates'], queryFn: listTemplates });

  const funnel = funnelQuery.data;
  const templates = templatesQuery.data?.templates ?? [];
  const hasData = funnel && funnel.totals.sent > 0;

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <CategoryTile
          color="deep"
          title="Analytics"
          description="Funnel, template A/B performance, and 30-day trend."
          icon={BarChart3}
          compact
        />

        <div className="flex flex-col justify-between">
          <div>
            <Mono size="xs" color="fog">
              Performance
            </Mono>
            <h1 className="mt-1 font-display text-[38px] font-normal leading-[0.9] text-text-1">
              Your outreach, <span className="italic">measured</span>.
            </h1>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Link to="/pipeline" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Pipeline
              <span aria-hidden>→</span>
            </Link>
            <Link to="/apps/new" className={buttonVariants({ size: 'sm' })}>
              <Send className="size-4" />
              New dispatch
              <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </div>

      {funnelQuery.isPending || templatesQuery.isPending ? (
        <div className="space-y-6">
          <div className="flex h-[88px] items-stretch divide-x divide-pure/[0.06] border border-border bg-surface">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex flex-1 flex-col justify-center gap-2 px-6">
                <Skeleton className="h-3 w-16 bg-surface-2" />
                <Skeleton className="h-8 w-12 bg-surface-2" />
              </div>
            ))}
          </div>
          <Skeleton className="h-80 w-full rounded-card bg-surface" />
          <Skeleton className="h-80 w-full rounded-card bg-surface" />
        </div>
      ) : !hasData ? (
        <EmptyState />
      ) : (
        <>
          {/* Summary stats */}
          <div className="flex items-stretch divide-x divide-pure/[0.06] border border-border bg-surface">
            <Stat label="Sent" value={funnel.totals.sent} />
            <Stat label="Opened" value={funnel.totals.opened} />
            <Stat label="Replied" value={funnel.totals.replied} />
            <Stat label="Response rate" value={`${Math.round(funnel.rates.responseRate * 100)}%`} />
          </div>

          {/* Funnel + template ledger */}
          <div className="grid gap-6 lg:grid-cols-2">
            <FunnelBars totals={funnel.totals} />
            <TemplateLedger stats={funnel.perTemplate} templates={templates} />
          </div>

          {/* Trend */}
          <section className="border border-border bg-surface p-6">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <Mono size="xs" color="fog">
                  Trend
                </Mono>
                <p className="mt-1 font-sans text-base font-normal text-text-1">Sent per day — last 30 days</p>
              </div>
              <Mono size="xs" color="fog">
                {formatDateRange(funnel.trend)}
              </Mono>
            </div>
            <ActivityChart data={funnel.trend} />
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-1 flex-col justify-center px-6 py-5">
      <Mono size="xs" color="fog">
        {label}
      </Mono>
      <span className="mt-1 font-display text-[28px] font-normal leading-[0.95] text-text-1">{value}</span>
    </div>
  );
}
