'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import KanbanCard from './KanbanCard';
import type { Ticket } from '@/types';

interface KanbanColumnProps {
  stateName: string; // DevOps state name (e.g., 'New', 'Approved', 'In Progress')
  stateColor?: string; // Hex color from DevOps (without #)
  tickets: Ticket[];
  activeId?: number | null;
  ticketsWithUnrecognizedState?: Set<number>;
}

export default function KanbanColumn({
  stateName,
  stateColor,
  tickets,
  activeId,
  ticketsWithUnrecognizedState,
}: KanbanColumnProps) {
  const color = stateColor ? `#${stateColor}` : 'var(--text-muted)';

  const { setNodeRef, isOver } = useDroppable({
    id: stateName,
  });

  return (
    <div className="kanban-column">
      <div className="kanban-column-header">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{stateName}</h3>
        </div>
        <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
          {tickets.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`kanban-column-content ${isOver ? 'kanban-column-over' : ''}`}
      >
        <SortableContext items={tickets.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tickets.map((ticket) => (
            <KanbanCard
              key={ticket.id}
              ticket={ticket}
              isDragging={activeId === ticket.id}
              hasUnrecognizedState={ticketsWithUnrecognizedState?.has(ticket.id)}
            />
          ))}
        </SortableContext>

        {tickets.length === 0 && (
          <div className="flex h-24 items-center justify-center text-sm text-[var(--text-muted)]">
            No tickets
          </div>
        )}
      </div>
    </div>
  );
}
