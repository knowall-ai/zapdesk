'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

interface KanbanColumnProps {
  id: string;
  label: string;
  color: string;
  icon?: React.ReactNode;
  count: number;
  itemIds: (string | number)[];
  children: React.ReactNode;
  emptyText?: string;
}

export default function KanbanColumn({
  id,
  label,
  color,
  icon,
  count,
  itemIds,
  children,
  emptyText = 'No items',
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className="kanban-column">
      <div className="kanban-column-header">
        <div className="flex items-center gap-2">
          {icon ? (
            <span style={{ color }}>{icon}</span>
          ) : (
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
          )}
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{label}</h3>
        </div>
        <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
          {count}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`kanban-column-content ${isOver ? 'kanban-column-over' : ''}`}
      >
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {children}
        </SortableContext>

        {count === 0 && (
          <div className="flex h-20 items-center justify-center text-xs text-[var(--text-muted)]">
            {emptyText}
          </div>
        )}
      </div>
    </div>
  );
}
