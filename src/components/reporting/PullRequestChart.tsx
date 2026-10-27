'use client';

import { BRAND_COLORS } from '@/lib/brand';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { PullRequestHistoryPoint } from '@/lib/pr-history';

interface PullRequestChartProps {
  data: PullRequestHistoryPoint[];
  /** Shown instead of the chart while the request is in flight. */
  loading?: boolean;
}

const OPENED = '#3b82f6';
// Merged is a status (success), not the brand: the theme's success colour (src/lib/brand.ts)
const MERGED = BRAND_COLORS.success;

/**
 * Pull requests opened and merged over time on the Team page, as two
 * smoothed lines with a faint fill, so the rhythm of the work reads as rises
 * and dips rather than a picket fence of bars. Same palette as the ticket
 * charts: blue for new work, green for finished.
 */
export function PullRequestChart({ data, loading = false }: PullRequestChartProps) {
  if (loading) {
    return (
      <div className="flex h-[300px] items-center justify-center">
        <p style={{ color: 'var(--text-muted)' }}>Loading pull requests…</p>
      </div>
    );
  }

  if (data.every((p) => p.opened === 0 && p.merged === 0)) {
    return (
      <div className="flex h-[300px] items-center justify-center">
        <p style={{ color: 'var(--text-muted)' }}>No pull requests in this period</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="pr-opened-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={OPENED} stopOpacity={0.3} />
            <stop offset="100%" stopColor={OPENED} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="pr-merged-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={MERGED} stopOpacity={0.3} />
            <stop offset="100%" stopColor={MERGED} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
          axisLine={{ stroke: 'var(--border)' }}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ stroke: 'var(--border)' }}
          contentStyle={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            color: 'var(--text-primary)',
          }}
        />
        <Legend wrapperStyle={{ color: 'var(--text-secondary)', fontSize: 12 }} />
        <Area
          type="monotone"
          dataKey="opened"
          name="Opened"
          stroke={OPENED}
          strokeWidth={2}
          fill="url(#pr-opened-fill)"
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Area
          type="monotone"
          dataKey="merged"
          name="Merged"
          stroke={MERGED}
          strokeWidth={2}
          fill="url(#pr-merged-fill)"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
