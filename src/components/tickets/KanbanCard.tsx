'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Link from 'next/link';
import { Zap } from 'lucide-react';
import Avatar from '@/components/common/Avatar';
import PriorityIndicator from '@/components/common/PriorityIndicator';
import type { Ticket, WorkItem, WorkItemType } from '@/types';

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

function CardContent({
  item,
  typeInfo,
  organization,
  onZapClick,
}: {
  item: KanbanItem;
  typeInfo?: WorkItemType;
  organization?: { name: string };
  onZapClick?: (item: KanbanItem) => void;
}) {
  return (
    <>
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
          {typeInfo?.icon ? (
            <img src={typeInfo.icon} alt="" className="h-3.5 w-3.5" />
          ) : typeInfo?.color ? (
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: `#${typeInfo.color}` }}
            />
          ) : null}
          #{item.id}
        </span>
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
            {onZapClick && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onZapClick(item);
                }}
                className="rounded p-0.5 transition-colors hover:bg-[var(--surface-hover)]"
                style={{ color: 'var(--warning)', cursor: 'pointer' }}
                title="Send a Zap tip"
              >
                <Zap size={12} />
              </button>
            )}
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
    </>
  );
}

interface KanbanCardProps {
  item: KanbanItem;
  isDragging?: boolean;
  hasUnrecognizedState?: boolean;
  readOnly?: boolean;
  typeInfo?: WorkItemType;
  onItemClick?: (item: KanbanItem) => void;
  onZapClick?: (item: KanbanItem) => void;
}

export default function KanbanCard({
  item,
  isDragging,
  hasUnrecognizedState,
  readOnly = false,
  typeInfo,
  onItemClick,
  onZapClick,
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
      {onItemClick ? (
        <button
          type="button"
          className="block w-full text-left"
          onClick={(e) => {
            e.stopPropagation();
            onItemClick(item);
          }}
        >
          <CardContent
            item={item}
            typeInfo={typeInfo}
            organization={organization}
            onZapClick={onZapClick}
          />
        </button>
      ) : (
        <Link href={`/tickets/${item.id}`} className="block">
          <CardContent
            item={item}
            typeInfo={typeInfo}
            organization={organization}
            onZapClick={onZapClick}
          />
        </Link>
      )}
    </div>
  );
}
