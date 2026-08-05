import type {
  FunnelTrendPoint,
  FunnelTotals,
  PerTemplateStats,
  ResponseTimeBucket,
  TemplateUsageStat,
  TimingHourStat,
  ToneUsageStat,
} from '@jobmail/shared';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Send } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ActivityChart } from '@/components/ActivityChart';
import { EmptyState } from '@/components/EmptyState';
import { Mono } from '@/components/Mono';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getFunnelAnalytics,
  getResponseTimeAnalytics,
  getTemplateAnalytics,
  getTimingAnalytics,
  getToneAnalytics,
  listTemplates,
} from '@/lib/api';
import { chartTheme } from '@/lib/chartTheme';
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
    <section className="rounded-card border border-graphite bg-ink-2 p-4">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <Mono size="xs" color="fog">
            Funnel
          </Mono>
          <p className="mt-1 font-sans text-base font-normal text-paper">Application-level conversion.</p>
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
              <div className="flex items-center justify-between font-sans text-sm text-paper">
                <span>{step.label}</span>
                <div className="flex items-center gap-3">
                  {conversion !== null && (
                    <Mono size="xs" color="ash">
                      {conversion} of prev
                    </Mono>
                  )}
                  <Mono size="xs" color="pure" className="min-w-[2ch] text-right">
                    {value}
                  </Mono>
                </div>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-pill border border-graphite bg-transparent">
                <div
                  className="h-full rounded-pill bg-lime transition-[width] duration-500 ease-out"
                  style={{ width: value === 0 ? '0%' : `${Math.max(pct, 2)}%` }}
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
    <section className="overflow-hidden rounded-card border border-graphite bg-ink-2">
      <div className="border-b border-graphite px-4 py-4">
        <div className="flex items-end justify-between">
          <div>
            <Mono size="xs" color="fog">
              Templates
            </Mono>
            <p className="mt-1 font-sans text-base font-normal text-paper">A/B reply-rate ledger.</p>
          </div>
          <Mono size="xs" color="fog">
            {stats.length} total
          </Mono>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-graphite">
              <th className="px-4 py-3 text-left">
                <Mono size="xs" color="fog">
                  Template
                </Mono>
              </th>
              <th className="px-4 py-3 text-left">
                <Mono size="xs" color="fog">
                  Tone
                </Mono>
              </th>
              <th className="px-4 py-3 text-right">
                <Mono size="xs" color="fog">
                  Sent
                </Mono>
              </th>
              <th className="px-4 py-3 text-right">
                <Mono size="xs" color="fog">
                  Opened
                </Mono>
              </th>
              <th className="px-4 py-3 text-right">
                <Mono size="xs" color="fog">
                  Replied
                </Mono>
              </th>
              <th className="px-4 py-3 text-right">
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
                <tr key={t.templateId} className={cn(i !== stats.length - 1 && 'border-b border-graphite')}>
                  <td className="px-4 py-3.5">
                    <p className="font-sans text-[15px] font-normal text-paper">{t.name}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <Mono size="xs" color="ash" className="capitalize">
                      {tone}
                    </Mono>
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <Mono size="xs" color="ash">
                      {t.sent}
                    </Mono>
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <Mono size="xs" color="ash">
                      {t.opened}
                    </Mono>
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <Mono size="xs" color="ash">
                      {t.replied}
                    </Mono>
                  </td>
                  <td className="px-4 py-3.5 text-right">
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

/* ── Phase 5 panels: timing, template, tone, response time ──────────────── */

/** 9 → '9am', 0 → '12am', 15 → '3pm'. */
function formatHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${hour < 12 ? 'am' : 'pm'}`;
}

function pctLabel(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** Compact duration: 0.5 → '30m', 18.5 → '18.5h', 96 → '4d'. */
function formatHoursCompact(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}

/** Card shell shared by the four analytics panels. */
function Panel({
  kicker,
  title,
  meta,
  children,
}: {
  kicker: string;
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-graphite bg-ink-2 p-4">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <Mono size="xs" color="fog">
            {kicker}
          </Mono>
          <p className="mt-1 font-sans text-base font-normal text-paper">{title}</p>
        </div>
        {meta && (
          <Mono size="xs" color="fog">
            {meta}
          </Mono>
        )}
      </div>
      {children}
    </section>
  );
}

/** Quiet empty line at chart height — no fake zeros. */
function PanelQuiet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[220px] items-center justify-center">
      <p className="font-sans text-sm font-normal text-text-3-dark">{children}</p>
    </div>
  );
}

/** Ink-2 tooltip card — same grammar as ActivityChart's ChartTooltip. */
function TipCard({ kicker, rows }: { kicker: string; rows: { label: string; value: string }[] }) {
  return (
    <div className="rounded-btn border border-graphite bg-ink-2 px-3.5 py-2.5">
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16px] text-text-3-dark">
        {kicker}
      </p>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2 text-xs">
            <span className="size-1.5 rounded-full bg-lime" />
            <span className="text-text-2-dark">{row.label}</span>
            <span className="ml-auto pl-4 font-mono text-xs tabular-nums text-paper">
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Subtle per-bar hover cursor — a low-alpha graphite band, never a wash. */
const barCursor = { fill: 'var(--graphite)', fillOpacity: 0.35 };

/**
 * Selective direct label: renders ONLY for the target bar, in lime mono —
 * the panel's single sanctioned lime callout (all other text wears ink).
 */
function limeBarLabel(targetIndex: number, text: string, placement: 'top' | 'right') {
  return function LimeBarLabel(props: unknown) {
    const { x, y, width, height, index } = props as {
      x?: number | string;
      y?: number | string;
      width?: number | string;
      height?: number | string;
      index?: number;
    };
    if (index !== targetIndex) return null;
    const common = { fill: 'var(--lime)', fontFamily: 'Roboto Mono', fontSize: 10 };
    return placement === 'top' ? (
      <text {...common} x={Number(x ?? 0) + Number(width ?? 0) / 2} y={Number(y ?? 0) - 6} textAnchor="middle">
        {text}
      </text>
    ) : (
      <text
        {...common}
        x={Number(x ?? 0) + Number(width ?? 0) + 6}
        y={Number(y ?? 0) + Number(height ?? 0) / 2}
        dominantBaseline="central"
      >
        {text}
      </text>
    );
  };
}

/* ── Best time to send ── */

function TimingTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: TimingHourStat }[];
}) {
  const stat = payload?.[0]?.payload;
  if (!active || !stat) return null;
  return (
    <TipCard
      kicker={`${formatHour(stat.hour)}–${formatHour((stat.hour + 1) % 24)}`}
      rows={[
        { label: 'Sent', value: String(stat.sent) },
        { label: 'Opened', value: String(stat.opened) },
        { label: 'Open rate', value: stat.sent === 0 ? '—' : pctLabel(stat.openRate) },
      ]}
    />
  );
}

function TimingPanel() {
  const query = useQuery({ queryKey: ['analytics', 'timing'], queryFn: getTimingAnalytics });
  const hours = query.data?.hours ?? [];
  const bestHour = query.data?.bestHour ?? null;
  const totalSent = hours.reduce((sum, h) => sum + h.sent, 0);

  return (
    <Panel kicker="Timing" title="Best time to send." meta={totalSent > 0 ? `${totalSent} sent` : undefined}>
      {query.isPending ? (
        <Skeleton className="h-[220px] w-full" />
      ) : bestHour === null ? (
        <PanelQuiet>No sends yet — timing appears after the first dispatch.</PanelQuiet>
      ) : (
        <>
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hours} margin={{ top: 16, right: 4, bottom: 0, left: -18 }} barCategoryGap="25%">
                <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                <XAxis
                  dataKey="hour"
                  tickFormatter={formatHour}
                  interval={2}
                  tick={chartTheme.tick}
                  tickLine={false}
                  axisLine={{ stroke: chartTheme.grid }}
                />
                <YAxis allowDecimals={false} tick={chartTheme.tick} tickLine={false} axisLine={false} />
                <Tooltip content={<TimingTip />} cursor={barCursor} />
                <Bar dataKey="sent" fill={chartTheme.accent} radius={[3, 3, 0, 0]} maxBarSize={14}>
                  <LabelList content={limeBarLabel(bestHour, 'BEST', 'top')} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 border-t border-graphite pt-3">
            <Mono size="xs" color="ash">
              Best hour · {formatHour(bestHour)} · {pctLabel(hours[bestHour]?.openRate ?? 0)} opened
            </Mono>
          </div>
        </>
      )}
    </Panel>
  );
}

/* ── Reply rate by template ── */

type TemplateRow = TemplateUsageStat & { replyPct: number };

function truncateName(name: string): string {
  return name.length > 12 ? `${name.slice(0, 11)}…` : name;
}

function TemplateTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: TemplateRow }[];
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <TipCard
      kicker={row.name}
      rows={[
        { label: 'Sent', value: String(row.sent) },
        { label: 'Replied', value: String(row.replied) },
        { label: 'Reply rate', value: pctLabel(row.replyRate) },
      ]}
    />
  );
}

const MAX_TEMPLATE_BARS = 6;

function TemplatePanel() {
  const query = useQuery({ queryKey: ['analytics', 'by-template'], queryFn: getTemplateAnalytics });
  const all = query.data?.templates ?? [];
  const rows: TemplateRow[] = all
    .slice(0, MAX_TEMPLATE_BARS)
    .map((t) => ({ ...t, replyPct: Math.round(t.replyRate * 100) }));
  const bestIndex = rows.reduce((best, row, i) => (row.replyPct > rows[best].replyPct ? i : best), 0);

  return (
    <Panel
      kicker="Templates"
      title="Reply rate by template."
      meta={
        all.length > rows.length ? `top ${rows.length} of ${all.length}` : all.length > 0 ? `${all.length} total` : undefined
      }
    >
      {query.isPending ? (
        <Skeleton className="h-[220px] w-full" />
      ) : rows.length === 0 ? (
        <PanelQuiet>No sends yet — template performance appears after the first dispatch.</PanelQuiet>
      ) : (
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={rows}
              margin={{ top: 4, right: 36, bottom: 0, left: 0 }}
              barCategoryGap="30%"
            >
              <CartesianGrid stroke={chartTheme.grid} horizontal={false} />
              <XAxis
                type="number"
                domain={[0, 100]}
                tickFormatter={(value: number) => `${value}%`}
                tick={chartTheme.tick}
                tickLine={false}
                axisLine={{ stroke: chartTheme.grid }}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={96}
                tickFormatter={truncateName}
                tick={chartTheme.tick}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<TemplateTip />} cursor={barCursor} />
              <Bar dataKey="replyPct" fill={chartTheme.accent} radius={[0, 3, 3, 0]} maxBarSize={14}>
                {rows[bestIndex].replyPct > 0 && (
                  <LabelList content={limeBarLabel(bestIndex, `${rows[bestIndex].replyPct}%`, 'right')} />
                )}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

/* ── Reply rate by tone ── */

type ToneRow = ToneUsageStat & { replyPct: number };

function ToneTip({ active, payload }: { active?: boolean; payload?: { payload?: ToneRow }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <TipCard
      kicker={row.tone}
      rows={[
        { label: 'Sent', value: String(row.sent) },
        { label: 'Replied', value: String(row.replied) },
        { label: 'Reply rate', value: pctLabel(row.replyRate) },
      ]}
    />
  );
}

function TonePanel() {
  const query = useQuery({ queryKey: ['analytics', 'by-tone'], queryFn: getToneAnalytics });
  const rows: ToneRow[] = (query.data?.tones ?? []).map((t) => ({
    ...t,
    replyPct: Math.round(t.replyRate * 100),
  }));
  const totalSent = rows.reduce((sum, r) => sum + r.sent, 0);
  const bestIndex = rows.reduce((best, row, i) => (row.replyPct > rows[best].replyPct ? i : best), 0);

  return (
    <Panel kicker="Tone" title="Reply rate by tone." meta={totalSent > 0 ? `${totalSent} sent` : undefined}>
      {query.isPending ? (
        <Skeleton className="h-[220px] w-full" />
      ) : rows.length === 0 ? (
        <PanelQuiet>No template-based sends yet — tone comes from the template used.</PanelQuiet>
      ) : (
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 16, right: 4, bottom: 0, left: -18 }} barCategoryGap="35%">
              <CartesianGrid stroke={chartTheme.grid} vertical={false} />
              <XAxis
                dataKey="tone"
                tickFormatter={(tone: string) => tone.toUpperCase()}
                tick={chartTheme.tick}
                tickLine={false}
                axisLine={{ stroke: chartTheme.grid }}
              />
              <YAxis
                domain={[0, 100]}
                tickFormatter={(value: number) => `${value}%`}
                tick={chartTheme.tick}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<ToneTip />} cursor={barCursor} />
              <Bar dataKey="replyPct" fill={chartTheme.accent} radius={[3, 3, 0, 0]} barSize={20}>
                {rows[bestIndex].replyPct > 0 && (
                  <LabelList content={limeBarLabel(bestIndex, `${rows[bestIndex].replyPct}%`, 'top')} />
                )}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

/* ── Response time ── */

function ResponseTip({
  active,
  payload,
  total,
}: {
  active?: boolean;
  payload?: { payload?: ResponseTimeBucket }[];
  total?: number;
}) {
  const bucket = payload?.[0]?.payload;
  if (!active || !bucket) return null;
  return (
    <TipCard
      kicker={`Replied ${bucket.label}`}
      rows={[
        { label: 'Replies', value: String(bucket.count) },
        { label: 'Share', value: total ? pctLabel(bucket.count / total) : '—' },
      ]}
    />
  );
}

function ResponseTimePanel() {
  const query = useQuery({
    queryKey: ['analytics', 'response-time'],
    queryFn: getResponseTimeAnalytics,
  });
  const buckets = query.data?.buckets ?? [];
  const medianHours = query.data?.medianHours ?? null;
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  const bestIndex = buckets.reduce((best, b, i) => (b.count > buckets[best].count ? i : best), 0);

  return (
    <Panel kicker="Latency" title="Response time." meta={total > 0 ? `${total} replies` : undefined}>
      {query.isPending ? (
        <Skeleton className="h-[220px] w-full" />
      ) : total === 0 || medianHours === null ? (
        <PanelQuiet>No replies yet — latency appears once someone writes back.</PanelQuiet>
      ) : (
        <>
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={buckets} margin={{ top: 16, right: 4, bottom: 0, left: -18 }} barCategoryGap="25%">
                <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                <XAxis
                  dataKey="label"
                  interval={0}
                  tick={chartTheme.tick}
                  tickLine={false}
                  axisLine={{ stroke: chartTheme.grid }}
                />
                <YAxis allowDecimals={false} tick={chartTheme.tick} tickLine={false} axisLine={false} />
                <Tooltip content={<ResponseTip total={total} />} cursor={barCursor} />
                <Bar dataKey="count" fill={chartTheme.accent} radius={[3, 3, 0, 0]} barSize={18}>
                  <LabelList content={limeBarLabel(bestIndex, String(buckets[bestIndex].count), 'top')} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 border-t border-graphite pt-3">
            <Mono size="xs" color="ash">
              Median · {formatHoursCompact(medianHours)}
            </Mono>
          </div>
        </>
      )}
    </Panel>
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
    <div className="space-y-6">
      {/* Header */}
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="flex flex-col justify-between rounded-card border border-graphite bg-ink-2 p-6">
          <div className="flex size-9 items-center justify-center rounded-btn border border-graphite bg-ink-3 text-text-2-dark">
            <BarChart3 className="size-4" strokeWidth={1.5} />
          </div>
          <div className="mt-6">
            <h3 className="font-sans text-subheading text-paper">Analytics</h3>
            <p className="mt-2 font-sans text-sm font-normal leading-[1.5] text-text-2-dark">
              Funnel, template A/B performance, and 30-day trend.
            </p>
          </div>
        </div>

        <div className="flex flex-col justify-between">
          <div>
            <Mono size="xs" color="fog">
              Performance
            </Mono>
            <h1 className="mt-1 font-sans text-heading text-paper">
              Your outreach, measured.
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
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-graphite bg-graphite sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex flex-col justify-center gap-2 bg-ink-2 p-4">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-8 w-12" />
              </div>
            ))}
          </div>
          <Skeleton className="h-80 w-full rounded-card" />
          <Skeleton className="h-80 w-full rounded-card" />
        </div>
      ) : !hasData ? (
        <EmptyState
          headline={
            <>
              No dispatches yet. Send the first.
            </>
          }
          description="Once outreach is in flight, opens, replies, interviews, and offers appear here."
          action={{ to: '/apps/new', label: 'New dispatch' }}
        />
      ) : (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-graphite bg-graphite sm:grid-cols-4">
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
          <section className="rounded-card border border-graphite bg-ink-2 p-4">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <Mono size="xs" color="fog">
                  Trend
                </Mono>
                <p className="mt-1 font-sans text-base font-normal text-paper">Sent per day — last 30 days</p>
              </div>
              <Mono size="xs" color="fog">
                {formatDateRange(funnel.trend)}
              </Mono>
            </div>
            <ActivityChart data={funnel.trend} />
          </section>

          {/* Phase 5: timing, template, tone, response-time panels */}
          <div className="grid gap-6 lg:grid-cols-2">
            <TimingPanel />
            <TemplatePanel />
            <TonePanel />
            <ResponseTimePanel />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col justify-center bg-ink-2 p-4">
      <Mono size="xs" color="fog">
        {label}
      </Mono>
      <span className="mt-1 font-sans text-subheading text-paper">{value}</span>
    </div>
  );
}
