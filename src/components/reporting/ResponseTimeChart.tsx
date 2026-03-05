'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface ResponseTimeDataPoint {
  label: string;
  avgHours: number;
}

interface ResponseTimeChartProps {
  data: ResponseTimeDataPoint[];
}

export function ResponseTimeChart({ data }: ResponseTimeChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center">
        <p style={{ color: 'var(--text-muted)' }}>No response time data available</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="responseTimeGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
          axisLine={{ stroke: 'var(--border)' }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          label={{
            value: 'Hours',
            angle: -90,
            position: 'insideLeft',
            style: { fill: 'var(--text-muted)', fontSize: 12 },
          }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            color: 'var(--text-primary)',
          }}
          formatter={(value: number | undefined) => [
            `${(value ?? 0).toFixed(1)}h`,
            'Avg Response Time',
          ]}
        />
        <Area
          type="monotone"
          dataKey="avgHours"
          stroke="#22c55e"
          strokeWidth={2}
          fill="url(#responseTimeGradient)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
