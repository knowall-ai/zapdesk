'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import KanbanCard from './KanbanCard';
import type { Ticket, TicketStatus } from '@/types';

interface KanbanColumnProps {
  status: TicketStatus;
  tickets: Ticket[];
  activeId?: number | null;
}

const statusColors: Record<TicketStatus, string> = {
  New: 'var(--status-new)',
  Open: 'var(--status-open)',
  'In Progress': 'var(--status-progress)',
  Pending: 'var(--status-pending)',
  Resolved: 'var(--status-resolved)',
  Closed: 'var(--status-closed)',
};

export default function KanbanColumn({ status, tickets, activeId }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
  });

  return (
    <div className="kanban-column">
      <div className="kanban-column-header">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: statusColors[status] }}
          />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{status}</h3>
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
            <KanbanCard key={ticket.id} ticket={ticket} isDragging={activeId === ticket.id} />
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
