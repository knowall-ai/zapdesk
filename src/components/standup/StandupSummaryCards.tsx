'use client';

import { FolderOpen } from 'lucide-react';
import { getColumnIcon, getColumnColor } from './columnConfig';

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
    icon: getColumnIcon(col.name, col.category, 20),
    color: getColumnColor(col.name, col.category),
  }));

  cards.push({
    label: 'Projects',
    value: summary.projectCount,
    icon: <FolderOpen size={20} />,
    color: 'var(--text-muted)',
  });

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
