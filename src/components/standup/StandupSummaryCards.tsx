'use client';

import { CheckCircle2, Loader2, ListTodo, FolderOpen, Circle, Ban, XCircle } from 'lucide-react';

// Map DevOps state categories to display config
const categoryDisplay: Record<string, { icon: React.ReactNode; color: string }> = {
  Proposed: { icon: <Circle size={20} />, color: 'var(--status-new)' },
  InProgress: { icon: <Loader2 size={20} />, color: 'var(--status-in-progress)' },
  Resolved: { icon: <CheckCircle2 size={20} />, color: 'var(--status-resolved)' },
  Completed: { icon: <CheckCircle2 size={20} />, color: 'var(--status-resolved)' },
  Removed: { icon: <XCircle size={20} />, color: 'var(--text-muted)' },
};

function getIcon(name: string, category: string): React.ReactNode {
  if (name === 'To Do') return <ListTodo size={20} />;
  if (name === 'Blocked') return <Ban size={20} />;
  return categoryDisplay[category]?.icon || <Circle size={20} />;
}

function getColor(name: string, category: string): string {
  if (name === 'To Do') return '#eab308';
  if (name === 'Blocked') return '#ef4444';
  if (name === 'Resolved') return '#f97316';
  return categoryDisplay[category]?.color || 'var(--text-muted)';
}

interface StandupSummaryCardsProps {
  columns: { name: string; category: string }[];
  summary: {
    columnCounts: Record<string, number>;
    projectCount: number;
  };
}

export default function StandupSummaryCards({ columns, summary }: StandupSummaryCardsProps) {
  const cards = columns.map((col) => ({
    label: col.name,
    value: summary.columnCounts[col.name] || 0,
    icon: getIcon(col.name, col.category),
    color: getColor(col.name, col.category),
  }));

  // Add projects count card
  cards.push({
    label: 'Projects',
    value: summary.projectCount,
    icon: <FolderOpen size={20} />,
    color: 'var(--text-muted)',
  });

  // Dynamic grid: up to 7 cards per row
  const gridCols = Math.min(cards.length, 7);

  return (
    <div
      className="grid gap-4"
      style={{
        gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
      }}
    >
      {cards.map((card) => (
        <div
          key={card.label}
          className="card flex items-center gap-3 p-4"
          style={{ borderLeft: `3px solid ${card.color}` }}
        >
          <div style={{ color: card.color }}>{card.icon}</div>
          <div>
            <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {card.value}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {card.label}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
