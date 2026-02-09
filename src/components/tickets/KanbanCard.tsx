'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Link from 'next/link';
import Avatar from '@/components/common/Avatar';
import PriorityIndicator from '@/components/common/PriorityIndicator';
import type { Ticket } from '@/types';

interface KanbanCardProps {
  ticket: Ticket;
  isDragging?: boolean;
  hasUnrecognizedState?: boolean;
}

export default function KanbanCard({ ticket, isDragging, hasUnrecognizedState }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: ticket.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`kanban-card ${isDragging ? 'kanban-card-dragging' : ''} ${hasUnrecognizedState ? 'kanban-card-unrecognized' : ''}`}
      title={
        hasUnrecognizedState
          ? `State "${ticket.devOpsState}" is not a recognized Kanban column`
          : undefined
      }
    >
      <Link href={`/tickets/${ticket.id}`} className="block">
        <div className="mb-2 flex items-start justify-between gap-2">
          <span className="text-xs text-[var(--text-muted)]">#{ticket.id}</span>
          <PriorityIndicator priority={ticket.priority} />
        </div>

        <h4 className="mb-3 line-clamp-2 text-sm font-medium text-[var(--text-primary)]">
          {ticket.title}
        </h4>

        <div className="flex items-center justify-between">
          {ticket.assignee ? (
            <div className="flex items-center gap-1.5">
              <Avatar name={ticket.assignee.displayName} size="sm" />
              <span className="max-w-[100px] truncate text-xs text-[var(--text-secondary)]">
                {ticket.assignee.displayName}
              </span>
            </div>
          ) : (
            <span className="text-xs text-[var(--text-muted)]">Unassigned</span>
          )}

          {ticket.organization && (
            <span className="max-w-[80px] truncate text-xs text-[var(--text-muted)]">
              {ticket.organization.name}
            </span>
          )}
        </div>
      </Link>
    </div>
  );
}
