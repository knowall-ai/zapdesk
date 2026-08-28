'use client';

import { useState, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import StandupKanbanCard from './StandupKanbanCard';
import { getColumnIcon, getColumnColor } from './columnConfig';
import {
  canTypeEnterColumn,
  resolveStateForColumn,
  type AllowedStates,
} from '@/lib/kanban-columns';
import type { StandupColumn, StandupWorkItem } from '@/types';
import { debugLog, debugWarn } from '@/lib/debug';

// Done-category columns only show items changed in the last 7 days; this hint
// explains the cutoff so users don't think older items have vanished.
const DONE_WINDOW_HINT = 'Showing items resolved or closed in the last 7 days';

/** Simple droppable column for the standup kanban */
function DroppableColumn({
  name,
  category,
  items,
  activeId,
  isBlocked = false,
  blockedReason,
  onItemClick,
}: {
  name: string;
  category: string;
  items: StandupWorkItem[];
  activeId: number | null;
  /** The dragged card's type has no state for this column — refuse the drop. */
  isBlocked?: boolean;
  blockedReason?: string;
  onItemClick?: (item: StandupWorkItem) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: name, disabled: isBlocked });
  const color = getColumnColor(name, category);
  const isDoneColumn = category === 'Resolved' || category === 'Completed';

  return (
    <div
      className="kanban-column"
      style={isBlocked ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
      title={isBlocked ? blockedReason : undefined}
    >
      <div className="kanban-column-header">
        <div className="flex items-center gap-2">
          <span style={{ color }}>{getColumnIcon(name, category)}</span>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{name}</h3>
          {isDoneColumn && (
            <button
              type="button"
              title={DONE_WINDOW_HINT}
              aria-label={DONE_WINDOW_HINT}
              className="cursor-help"
              style={{ color: 'var(--text-muted)' }}
            >
              <Info size={12} />
            </button>
          )}
        </div>
        <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
          {items.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`kanban-column-content ${isOver ? 'kanban-column-over' : ''}`}
      >
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <StandupKanbanCard
              key={item.id}
              item={item}
              isDragging={activeId === item.id}
              onClick={onItemClick}
            />
          ))}
        </SortableContext>

        {items.length === 0 && (
          <div className="flex h-20 items-center justify-center text-xs text-[var(--text-muted)]">
            No items
          </div>
        )}
      </div>
    </div>
  );
}

interface KanbanGroupSectionProps {
  groupName: string;
  columns: StandupColumn[];
  /** Project -> work item type -> states that type defines there. Omit to allow every drop. */
  allowedStatesByProjectType?: AllowedStates;
  onStateChange?: (itemId: number, targetState: string) => Promise<void>;
  onItemClick?: (item: StandupWorkItem) => void;
}

export default function KanbanGroupSection({
  groupName,
  columns,
  allowedStatesByProjectType,
  onStateChange,
  onItemClick,
}: KanbanGroupSectionProps) {
  const columnNames = useMemo(() => columns.map((c) => c.name), [columns]);
  const totalItems = useMemo(() => columns.reduce((sum, c) => sum + c.items.length, 0), [columns]);

  const [expanded, setExpanded] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // What the server last told us, keyed by column name.
  const propItems = useMemo(() => {
    const map: Record<string, StandupWorkItem[]> = {};
    for (const col of columns) {
      map[col.name] = col.items;
    }
    return map;
  }, [columns]);

  // Local copy so a drag can move cards optimistically before the server confirms.
  const [localItems, setLocalItems] = useState<Record<string, StandupWorkItem[]>>(propItems);
  const [syncedItems, setSyncedItems] = useState(propItems);

  // Adopt new server data as it arrives. Done during render rather than in an
  // effect: React restarts the render with the new state before painting, so
  // the board never flashes the stale columns first.
  if (syncedItems !== propItems) {
    setSyncedItems(propItems);
    setLocalItems(propItems);
  }

  // Roll the optimistic board back to the server's version after a drag that
  // didn't stick, or one we never sent.
  const syncFromProps = useCallback(() => {
    setLocalItems(propItems);
  }, [propItems]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Find which column an item is in
  const findColumn = useCallback(
    (itemId: number | string): string | null => {
      const id = Number(itemId);
      for (const colName of columnNames) {
        if (localItems[colName]?.some((i) => i.id === id)) return colName;
      }
      // Check if the ID is a column name
      if (columnNames.includes(String(itemId))) return String(itemId);
      return null;
    },
    [localItems, columnNames]
  );

  const activeItem = useMemo(() => {
    if (!activeId) return null;
    for (const colName of columnNames) {
      const found = localItems[colName]?.find((i) => i.id === activeId);
      if (found) return found;
    }
    return null;
  }, [activeId, localItems, columnNames]);

  // Columns the dragged card can't enter, because its work item type defines no
  // matching state. Empty while nothing is being dragged, and empty whenever we
  // have no state list for the type — the server stays the authority (#391).
  const blockedColumns = useMemo(() => {
    if (!activeItem) return new Set<string>();
    return new Set(
      columnNames.filter(
        (name) =>
          !canTypeEnterColumn(
            activeItem.project,
            activeItem.workItemType,
            name,
            allowedStatesByProjectType
          )
      )
    );
  }, [activeItem, columnNames, allowedStatesByProjectType]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as number);
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeItemId = active.id as number;
      const overId = String(over.id);

      const sourceCol = findColumn(activeItemId);
      const targetCol = columnNames.includes(overId) ? overId : findColumn(overId);

      if (!sourceCol || !targetCol || sourceCol === targetCol) return;

      setLocalItems((prev) => {
        const item = prev[sourceCol]?.find((i) => i.id === activeItemId);
        if (!item) return prev;
        return {
          ...prev,
          [sourceCol]: prev[sourceCol].filter((i) => i.id !== activeItemId),
          [targetCol]: [...(prev[targetCol] || []), item],
        };
      });
    },
    [findColumn, columnNames]
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active } = event;
      setActiveId(null);

      if (!event.over || !onStateChange) {
        // Rollback visual state if no handler
        syncFromProps();
        return;
      }

      const activeItemId = active.id as number;
      const targetCol = findColumn(activeItemId);
      if (!targetCol) {
        // Not gated: the dragged card is in no column at all, which means our
        // local state and the columns disagree. That is a real fault, not a
        // user action, and it is rare enough not to be per-drag noise.
        console.warn('[Standup DnD] dropped item is in no column', { activeItemId });
        // handleDragOver may already have moved the card in localItems, so
        // bail out through the same rollback every other early return uses.
        syncFromProps();
        return;
      }

      // Find original column from props
      const originalCol = columns.find((c) => c.items.some((i) => i.id === activeItemId));
      if (originalCol?.name === targetCol) return; // No change

      // Blocked columns are already disabled as drop targets, so this only
      // trips if the cached state list went stale mid-session. Say so plainly
      // rather than letting DevOps answer with a raw rule error.
      const dragged = originalCol?.items.find((i) => i.id === activeItemId);
      if (
        dragged &&
        !canTypeEnterColumn(
          dragged.project,
          dragged.workItemType,
          targetCol,
          allowedStatesByProjectType
        )
      ) {
        syncFromProps();
        // Gated, unlike the fault above: a blocked drop is an ordinary,
        // expected outcome — the column is already disabled as a drop target
        // and the user gets a toast — so logging it every time is exactly the
        // per-drag noise this PR set out to remove.
        debugWarn('[Standup DnD] drop blocked by the type’s state list', {
          itemId: activeItemId,
          workItemType: dragged.workItemType,
          project: dragged.project,
          fromColumn: originalCol?.name,
          targetColumn: targetCol,
        });
        toast.error(`${dragged.workItemType} work items have no "${targetCol}" state`);
        return;
      }

      // The column label is not necessarily the state name — "To Do" is the
      // state "Todo" in the KnowAll process — so translate before writing.
      const resolvedState = resolveStateForColumn(
        dragged?.project,
        dragged?.workItemType,
        targetCol,
        allowedStatesByProjectType
      );

      debugLog('[Standup DnD] drag end', {
        itemId: activeItemId,
        workItemType: dragged?.workItemType,
        project: dragged?.project,
        fromColumn: originalCol?.name,
        targetColumn: targetCol,
        resolvedState,
        blockedColumns: [...blockedColumns],
      });

      setIsUpdating(true);
      try {
        await onStateChange(activeItemId, resolvedState);
        debugLog('[Standup DnD] state change succeeded', {
          itemId: activeItemId,
          resolvedState,
        });
      } catch (error) {
        // Not gated: a rejected transition is rare and its detail is the
        // whole point of issue #391.
        console.error('[Standup DnD] state change failed — rolling back', {
          itemId: activeItemId,
          fromColumn: originalCol?.name,
          targetColumn: targetCol,
          resolvedState,
          error,
        });
        syncFromProps();
        // Surface the upstream reason. A work item can only enter states its
        // own work item type defines, so drops onto a column the type has no
        // state for are rejected by DevOps ("TF401320: Rule Error…"). Without
        // this toast the card just snaps back with no explanation (#391, #366).
        toast.error(
          error instanceof Error && error.message
            ? `Couldn't move to "${targetCol}": ${error.message}`
            : `Couldn't move to "${targetCol}"`
        );
      } finally {
        setIsUpdating(false);
      }
    },
    [onStateChange, findColumn, columns, allowedStatesByProjectType, syncFromProps, blockedColumns]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    syncFromProps();
  }, [syncFromProps]);

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-white/5"
      >
        <span style={{ color: 'var(--text-muted)' }}>
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </span>

        <h3 className="flex-1 text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
          {groupName}
        </h3>

        {totalItems === 0 && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No items
          </span>
        )}
      </button>

      {/* Kanban board */}
      {expanded && totalItems > 0 && (
        <div className="border-t" style={{ borderColor: 'var(--border)' }}>
          {isUpdating && (
            <div className="bg-[var(--primary)] px-4 py-1.5 text-center text-xs text-white">
              Updating...
            </div>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div className="kanban-columns" style={{ padding: '0.75rem' }}>
              {columns.map((col) => {
                const items = localItems[col.name] || [];
                const isBlocked = blockedColumns.has(col.name);
                return (
                  <DroppableColumn
                    key={col.name}
                    name={col.name}
                    category={col.category}
                    items={items}
                    activeId={activeId}
                    isBlocked={isBlocked}
                    blockedReason={
                      isBlocked && activeItem
                        ? `${activeItem.workItemType} work items have no "${col.name}" state`
                        : undefined
                    }
                    onItemClick={onItemClick}
                  />
                );
              })}
            </div>

            <DragOverlay>
              {activeItem ? <StandupKanbanCard item={activeItem} isDragging /> : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}
    </div>
  );
}
