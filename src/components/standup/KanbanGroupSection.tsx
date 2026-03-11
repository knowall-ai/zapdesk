'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
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
import { ChevronDown, ChevronRight } from 'lucide-react';
import StandupKanbanCard from './StandupKanbanCard';
import { getColumnIcon, getColumnColor } from './columnConfig';
import type { StandupColumn, StandupWorkItem } from '@/types';

/** Simple droppable column for the standup kanban */
function DroppableColumn({
  name,
  category,
  items,
  activeId,
}: {
  name: string;
  category: string;
  items: StandupWorkItem[];
  activeId: number | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: name });
  const color = getColumnColor(name, category);

  return (
    <div className="kanban-column">
      <div className="kanban-column-header">
        <div className="flex items-center gap-2">
          <span style={{ color }}>{getColumnIcon(name, category)}</span>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{name}</h3>
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
            <StandupKanbanCard key={item.id} item={item} isDragging={activeId === item.id} />
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
  onStateChange?: (itemId: number, targetState: string) => Promise<void>;
}

export default function KanbanGroupSection({
  groupName,
  columns,
  onStateChange,
}: KanbanGroupSectionProps) {
  const columnNames = useMemo(() => columns.map((c) => c.name), [columns]);
  const totalItems = useMemo(() => columns.reduce((sum, c) => sum + c.items.length, 0), [columns]);

  const [expanded, setExpanded] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Local state for drag-and-drop reactivity, keyed by column name
  const [localItems, setLocalItems] = useState<Record<string, StandupWorkItem[]>>(() => {
    const map: Record<string, StandupWorkItem[]> = {};
    for (const col of columns) {
      map[col.name] = col.items;
    }
    return map;
  });

  // Sync with prop changes (e.g. after refresh)
  useEffect(() => {
    const map: Record<string, StandupWorkItem[]> = {};
    for (const col of columns) {
      map[col.name] = col.items;
    }
    setLocalItems(map);
  }, [columns]);

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
        const map: Record<string, StandupWorkItem[]> = {};
        for (const col of columns) {
          map[col.name] = col.items;
        }
        setLocalItems(map);
        return;
      }

      const activeItemId = active.id as number;
      const targetCol = findColumn(activeItemId);
      if (!targetCol) return;

      // Find original column from props
      const originalCol = columns.find((c) => c.items.some((i) => i.id === activeItemId));
      if (originalCol?.name === targetCol) return; // No change

      setIsUpdating(true);
      try {
        // targetCol IS the DevOps state name — pass it directly
        await onStateChange(activeItemId, targetCol);
      } catch (error) {
        console.error('Failed to update state:', error);
        // Rollback
        const map: Record<string, StandupWorkItem[]> = {};
        for (const col of columns) {
          map[col.name] = col.items;
        }
        setLocalItems(map);
      } finally {
        setIsUpdating(false);
      }
    },
    [onStateChange, findColumn, columns]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    const map: Record<string, StandupWorkItem[]> = {};
    for (const col of columns) {
      map[col.name] = col.items;
    }
    setLocalItems(map);
  }, [columns]);

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
                return (
                  <DroppableColumn
                    key={col.name}
                    name={col.name}
                    category={col.category}
                    items={items}
                    activeId={activeId}
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
