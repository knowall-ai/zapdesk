'use client';

import { useMemo } from 'react';
import type { TicketTrendPoint } from '@/types';

interface TrendChartsProps {
  trends: TicketTrendPoint[];
}

// Chart constants
const CHART_WIDTH = 600;
const CHART_HEIGHT = 200;
const PADDING = { top: 20, right: 20, bottom: 40, left: 50 };

interface DualLineChartProps {
  data: { label: string; value1: number; value2: number }[];
  color1: string;
  color2: string;
  title: string;
  legend1: string;
  legend2: string;
  yAxisLabel: string;
}

function DualLineChart({
  data,
  color1,
  color2,
  title,
  legend1,
  legend2,
  yAxisLabel,
}: DualLineChartProps) {
  const innerWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const innerHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  const { points1, points2, maxValue, minValue } = useMemo(() => {
    if (data.length === 0) return { points1: '', points2: '', maxValue: 0, minValue: 0 };

    const allValues = [...data.map((d) => d.value1), ...data.map((d) => d.value2)];
    const max = Math.max(...allValues, 1);
    const min = Math.min(...allValues, 0);
    const range = max - min || 1;

    const pts1 = data
      .map((d, i) => {
        const x = PADDING.left + (i / (data.length - 1 || 1)) * innerWidth;
        const y = PADDING.top + innerHeight - ((d.value1 - min) / range) * innerHeight;
        return `${x},${y}`;
      })
      .join(' ');

    const pts2 = data
      .map((d, i) => {
        const x = PADDING.left + (i / (data.length - 1 || 1)) * innerWidth;
        const y = PADDING.top + innerHeight - ((d.value2 - min) / range) * innerHeight;
        return `${x},${y}`;
      })
      .join(' ');

    return { points1: pts1, points2: pts2, maxValue: max, minValue: min };
  }, [data, innerWidth, innerHeight]);

  const gridLines = useMemo(() => {
    const lines = [];
    const steps = 4;

    for (let i = 0; i <= steps; i++) {
      const y = PADDING.top + (i / steps) * innerHeight;
      const value = maxValue - (i / steps) * (maxValue - minValue);
      lines.push({ y, value });
    }
    return lines;
  }, [maxValue, minValue, innerHeight]);

  const xAxisLabels = useMemo(() => {
    if (data.length <= 7) return data.map((d, i) => ({ label: d.label, index: i }));

    const step = Math.ceil(data.length / 7);
    return data
      .filter((_d, i) => i % step === 0 || i === data.length - 1)
      .map((d) => ({
        label: d.label,
        index: data.findIndex((item) => item.label === d.label),
      }));
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="card p-4">
        <h3 className="mb-4 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h3>
        <div
          className="flex h-48 items-center justify-center"
          style={{ color: 'var(--text-muted)' }}
        >
          No data available
        </div>
      </div>
    );
  }

  return (
    <div className="card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h3>
        <div className="flex gap-4 text-xs">
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: color1 }}></div>
            <span style={{ color: 'var(--text-muted)' }}>{legend1}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: color2 }}></div>
            <span style={{ color: 'var(--text-muted)' }}>{legend2}</span>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="w-full"
          style={{ minWidth: '400px' }}
        >
          {/* Grid lines */}
          {gridLines.map((line, i) => (
            <g key={i}>
              <line
                x1={PADDING.left}
                y1={line.y}
                x2={CHART_WIDTH - PADDING.right}
                y2={line.y}
                stroke="var(--border)"
                strokeDasharray="2,2"
              />
              <text
                x={PADDING.left - 8}
                y={line.y + 4}
                textAnchor="end"
                fontSize="10"
                fill="var(--text-muted)"
              >
                {Math.round(line.value)}
              </text>
            </g>
          ))}

          {/* Y-axis label */}
          <text
            x={12}
            y={CHART_HEIGHT / 2}
            textAnchor="middle"
            fontSize="10"
            fill="var(--text-muted)"
            transform={`rotate(-90, 12, ${CHART_HEIGHT / 2})`}
          >
            {yAxisLabel}
          </text>

          {/* Line 1 */}
          <polyline fill="none" stroke={color1} strokeWidth="2" points={points1} />

          {/* Line 2 */}
          <polyline fill="none" stroke={color2} strokeWidth="2" points={points2} />

          {/* X-axis labels */}
          {xAxisLabels.map(({ label, index }) => {
            const x = PADDING.left + (index / (data.length - 1 || 1)) * innerWidth;
            return (
              <text
                key={label}
                x={x}
                y={CHART_HEIGHT - 10}
                textAnchor="middle"
                fontSize="9"
                fill="var(--text-muted)"
              >
                {new Date(label).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export function TrendCharts({ trends }: TrendChartsProps) {
  const ticketVolumeData = useMemo(
    () =>
      trends.map((t) => ({
        label: t.date,
        value1: t.ticketsCreated,
        value2: t.ticketsResolved,
      })),
    [trends]
  );

  const slaMetricsData = useMemo(
    () =>
      trends.map((t) => ({
        label: t.date,
        value1: t.avgResponseTimeHours,
        value2: t.avgResolutionTimeHours,
      })),
    [trends]
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <DualLineChart
        data={ticketVolumeData}
        color1="var(--status-new)"
        color2="var(--status-resolved)"
        title="Ticket Volume"
        legend1="Created"
        legend2="Resolved"
        yAxisLabel="Tickets"
      />
      <DualLineChart
        data={slaMetricsData}
        color1="var(--priority-high)"
        color2="var(--primary)"
        title="SLA Metrics"
        legend1="Response Time"
        legend2="Resolution Time"
        yAxisLabel="Hours"
      />
    </div>
  );
}
