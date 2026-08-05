import type { FunnelTrendPoint } from '@jobmail/shared';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { chartTheme } from '@/lib/chartTheme';

/** 'YYYY-MM-DD' (UTC) → 'Jul 20'. */
function formatDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

interface ActivityChartProps {
  data: FunnelTrendPoint[];
  height?: number;
  showTooltip?: boolean;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value?: number }[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0 || !label) return null;
  return (
    <div className="rounded-func border border-border bg-surface px-3.5 py-2.5 shadow-lg">
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16px] text-text-3">
        {formatDay(label)}
      </p>
      <div className="flex items-center gap-2 text-xs">
        <span className="size-1.5 rounded-full bg-cyan" />
        <span className="text-text-2">Sent</span>
        <span className="ml-auto pl-4 font-mono text-xs tabular-nums text-pure">
          {payload[0]?.value ?? 0}
        </span>
      </div>
    </div>
  );
}

export function ActivityChart({ data, height = 260, showTooltip = true }: ActivityChartProps) {
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={chartTheme.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDay}
            tick={chartTheme.tick}
            tickLine={false}
            axisLine={{ stroke: chartTheme.grid }}
            minTickGap={32}
          />
          <YAxis
            allowDecimals={false}
            tick={chartTheme.tick}
            tickLine={false}
            axisLine={false}
          />
          {showTooltip && (
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: chartTheme.cursor, strokeDasharray: '3 3' }}
            />
          )}
          <Line
            type="monotone"
            dataKey="sent"
            stroke={chartTheme.accent}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 0, fill: chartTheme.accent }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
