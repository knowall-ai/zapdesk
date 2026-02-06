'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import KanbanCard from './KanbanCard';
import type { Ticket, WorkItem, WorkItemType } from '@/types';

// KanbanColumn can work with either Ticket[] or WorkItem[]
type KanbanItem = Ticket | WorkItem;

interface KanbanColumnProps {
  stateName: string; // DevOps state name (e.g., 'New', 'Approved', 'In Progress')
  stateColor?: string; // Hex color from DevOps (without #)
  items: KanbanItem[];
  activeId?: number | null;
  itemsWithUnrecognizedState?: Set<number>;
  readOnly?: boolean;
  typeInfoMap?: Map<string, WorkItemType>;
}

export default function KanbanColumn({
  stateName,
  stateColor,
  items,
  activeId,
  itemsWithUnrecognizedState,
  readOnly = false,
  typeInfoMap,
}: KanbanColumnProps) {
  const color = stateColor ? `#${stateColor}` : 'var(--text-muted)';

  // Only use droppable in interactive mode
  const { setNodeRef, isOver } = useDroppable({
    id: stateName,
    disabled: readOnly,
  });

  // Render cards
  const cards = items.map((item) => {
    const itemType = 'workItemType' in item ? item.workItemType : undefined;
    return (
      <KanbanCard
        key={item.id}
        item={item}
        isDragging={activeId === item.id}
        hasUnrecognizedState={itemsWithUnrecognizedState?.has(item.id)}
        readOnly={readOnly}
        typeInfo={itemType && typeInfoMap ? typeInfoMap.get(itemType) : undefined}
      />
    );
  });

  return (
    <div className="kanban-column">
      <div className="kanban-column-header">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{stateName}</h3>
        </div>
        <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
          {items.length}
        </span>
      </div>

      <div
        ref={readOnly ? undefined : setNodeRef}
        className={`kanban-column-content ${isOver && !readOnly ? 'kanban-column-over' : ''}`}
      >
        {readOnly ? (
          // Read-only mode: render cards without sortable context
          cards
        ) : (
          // Interactive mode: wrap with SortableContext
          <SortableContext items={items.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {cards}
          </SortableContext>
        )}

        {items.length === 0 && (
          <div className="flex h-24 items-center justify-center text-sm text-[var(--text-muted)]">
            No items
          </div>
        )}
      </div>
    </div>
  );
}
