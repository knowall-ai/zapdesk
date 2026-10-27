'use client';

import { FolderOpen } from 'lucide-react';
import { getColumnIcon, getColumnColor } from './columnConfig';

interface StandupSummaryCardsProps {
  columns: { name: string; category: string }[];
  summary: {
    columnCounts: Record<string, number>;
    projectCount: number;
  };
  /** The state the board is narrowed to, if any. Its tile is shown as pressed. */
  activeColumn?: string | null;
  /** When given, each state tile is a button that narrows the board to that state (#320). */
  onColumnClick?: (columnName: string) => void;
}

export default function StandupSummaryCards({
  columns,
  summary,
  activeColumn = null,
  onColumnClick,
}: StandupSummaryCardsProps) {
  const gridCols = Math.min(columns.length + 1, 7);

  const tileBody = (value: number, label: string, icon: React.ReactNode, color: string) => (
    <>
      <div style={{ color }}>{icon}</div>
      <div>
        <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          {value}
        </div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {label}
        </div>
      </div>
    </>
  );

  return (
    <div
      className="grid gap-4"
      style={{
        gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
      }}
    >
      {columns.map((col) => {
        const color = getColumnColor(col.name, col.category);
        const value = summary.columnCounts[col.name] || 0;
        const body = tileBody(value, col.name, getColumnIcon(col.name, col.category, 20), color);

        if (!onColumnClick) {
          return (
            <div
              key={col.name}
              className="card flex items-center gap-3 p-4"
              style={{ borderLeft: `3px solid ${color}` }}
            >
              {body}
            </div>
          );
        }

        const isActive = activeColumn === col.name;
        return (
          <button
            key={col.name}
            type="button"
            onClick={() => onColumnClick(col.name)}
            aria-pressed={isActive}
            title={isActive ? 'Show every group again' : `Show only groups with ${col.name} items`}
            className="card flex items-center gap-3 p-4 text-left transition-colors hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-brand)]"
            style={{
              borderLeft: `3px solid ${color}`,
              // The pressed tile takes its state's colour all the way round.
              ...(isActive ? { borderColor: color, backgroundColor: 'var(--surface-hover)' } : {}),
            }}
          >
            {body}
          </button>
        );
      })}

      <div
        className="card flex items-center gap-3 p-4"
        style={{ borderLeft: '3px solid var(--text-muted)' }}
      >
        {tileBody(summary.projectCount, 'Projects', <FolderOpen size={20} />, 'var(--text-muted)')}
      </div>
    </div>
  );
}
