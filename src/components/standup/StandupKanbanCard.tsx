'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Link from 'next/link';
import { Avatar, PriorityIndicator } from '@/components/common';
import type { StandupWorkItem } from '@/types';

interface StandupKanbanCardProps {
  item: StandupWorkItem;
  isDragging?: boolean;
}

const typeColors: Record<string, string> = {
  Bug: '#cc293d',
  Task: '#f2cb1d',
  Enhancement: '#773b93',
  Question: '#009ccc',
  Issue: '#b4009e',
  Risk: '#ff7b00',
};

export default function StandupKanbanCard({ item, isDragging }: StandupKanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: item.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const typeColor = typeColors[item.workItemType] || 'var(--text-muted)';

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`kanban-card ${isDragging ? 'kanban-card-dragging' : ''}`}
    >
      <Link href={`/tickets/${item.id}`} className="block">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span
              className="rounded px-1 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: `${typeColor}20`,
                color: typeColor,
              }}
            >
              {item.workItemType}
            </span>
            <span className="text-xs text-[var(--text-muted)]">#{item.id}</span>
          </div>
          <PriorityIndicator priority={item.priority} />
        </div>

        <h4 className="mb-2 line-clamp-2 text-sm font-medium text-[var(--text-primary)]">
          {item.title}
        </h4>

        <div className="flex items-center justify-between">
          {item.assignee ? (
            <div className="flex items-center gap-1.5">
              <Avatar name={item.assignee.displayName} image={item.assignee.avatarUrl} size="sm" />
              <span className="max-w-[100px] truncate text-xs text-[var(--text-secondary)]">
                {item.assignee.displayName}
              </span>
            </div>
          ) : (
            <span className="text-xs text-[var(--text-muted)] italic">Unassigned</span>
          )}
        </div>
      </Link>
    </div>
  );
}
