'use client';

import {
  BarChart,
  Bar,
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

/**
 * Pull requests opened and merged per day, week or month on the Live
 * Dashboard. Same shape and palette as the ticket volume chart beside it, so
 * the page reads as one system: blue for new work, green for finished.
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
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
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
          cursor={{ fill: 'var(--surface-hover)' }}
          contentStyle={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            color: 'var(--text-primary)',
          }}
        />
        <Legend wrapperStyle={{ color: 'var(--text-secondary)', fontSize: 12 }} />
        <Bar dataKey="opened" name="Opened" fill="#3b82f6" radius={[4, 4, 0, 0]} />
        <Bar dataKey="merged" name="Merged" fill="#22c55e" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
