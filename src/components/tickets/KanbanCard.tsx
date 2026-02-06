'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Link from 'next/link';
import Avatar from '@/components/common/Avatar';
import PriorityIndicator from '@/components/common/PriorityIndicator';
import type { Ticket, WorkItem } from '@/types';

// KanbanCard can work with either Ticket or WorkItem
type KanbanItem = Ticket | WorkItem;

// Helper to get state from either Ticket or WorkItem
function getItemState(item: KanbanItem): string {
  if ('devOpsState' in item) {
    return item.devOpsState;
  }
  return item.state;
}

// Helper to get organization from item (only Ticket has it directly, WorkItem has it optional)
function getItemOrganization(item: KanbanItem): { name: string } | undefined {
  if ('organization' in item && item.organization) {
    return item.organization;
  }
  return undefined;
}

interface KanbanCardProps {
  item: KanbanItem;
  isDragging?: boolean;
  hasUnrecognizedState?: boolean;
  readOnly?: boolean;
}

export default function KanbanCard({
  item,
  isDragging,
  hasUnrecognizedState,
  readOnly = false,
}: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: item.id,
    disabled: readOnly,
  });

  const style = readOnly
    ? {}
    : {
        transform: CSS.Transform.toString(transform),
        transition,
      };

  const organization = getItemOrganization(item);

  return (
    <div
      ref={readOnly ? undefined : setNodeRef}
      style={style}
      {...(readOnly ? {} : attributes)}
      {...(readOnly ? {} : listeners)}
      className={`kanban-card ${isDragging ? 'kanban-card-dragging' : ''} ${hasUnrecognizedState ? 'kanban-card-unrecognized' : ''}`}
      title={
        hasUnrecognizedState
          ? `State "${getItemState(item)}" is not a recognized Kanban column`
          : undefined
      }
    >
      <Link href={`/tickets/${item.id}`} className="block">
        <div className="mb-2 flex items-start justify-between gap-2">
          <span className="text-xs text-[var(--text-muted)]">#{item.id}</span>
          <PriorityIndicator priority={item.priority} />
        </div>

        <h4 className="mb-3 line-clamp-2 text-sm font-medium text-[var(--text-primary)]">
          {item.title}
        </h4>

        <div className="flex items-center justify-between">
          {item.assignee ? (
            <div className="flex items-center gap-1.5">
              <Avatar name={item.assignee.displayName} size="sm" />
              <span className="max-w-[100px] truncate text-xs text-[var(--text-secondary)]">
                {item.assignee.displayName}
              </span>
            </div>
          ) : (
            <span className="text-xs text-[var(--text-muted)]">Unassigned</span>
          )}

          {organization && (
            <span className="max-w-[80px] truncate text-xs text-[var(--text-muted)]">
              {organization.name}
            </span>
          )}
        </div>
      </Link>
    </div>
  );
}
