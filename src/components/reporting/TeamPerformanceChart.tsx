'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface TeamPerformanceDataPoint {
  name: string;
  resolved: number;
}

interface TeamPerformanceChartProps {
  data: TeamPerformanceDataPoint[];
}

const BAR_COLORS = [
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
  '#f59e0b',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#06b6d4',
  '#ef4444',
  '#84cc16',
];

export function TeamPerformanceChart({ data }: TeamPerformanceChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center">
        <p style={{ color: 'var(--text-muted)' }}>No team data available</p>
      </div>
    );
  }

  const chartHeight = Math.max(200, data.length * 40 + 40);

  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
          axisLine={{ stroke: 'var(--border)' }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={120}
          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            color: 'var(--text-primary)',
          }}
          formatter={(value: number | undefined) => [`${value ?? 0} tickets`, 'Resolved']}
        />
        <Bar dataKey="resolved" radius={[0, 4, 4, 0]}>
          {data.map((_entry, index) => (
            <Cell key={`cell-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
