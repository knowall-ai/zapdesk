'use client';

import { useState, useMemo, useCallback } from 'react';
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
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Loader2,
  ListTodo,
  Circle,
  Ban,
  XCircle,
} from 'lucide-react';
import StandupKanbanCard from './StandupKanbanCard';
import type { ProjectStandupData, StandupWorkItem } from '@/types';

// Map DevOps state categories to icons and colors
const categoryConfig: Record<string, { icon: React.ReactNode; color: string }> = {
  Proposed: { icon: <Circle size={14} />, color: 'var(--status-new)' },
  InProgress: { icon: <Loader2 size={14} />, color: 'var(--status-in-progress)' },
  Resolved: { icon: <CheckCircle2 size={14} />, color: 'var(--status-resolved)' },
  Completed: { icon: <CheckCircle2 size={14} />, color: 'var(--status-resolved)' },
  Removed: { icon: <XCircle size={14} />, color: 'var(--text-muted)' },
};

// Override icon for specific state names
function getColumnIcon(stateName: string, category: string): React.ReactNode {
  if (stateName === 'To Do') return <ListTodo size={14} />;
  if (stateName === 'Blocked') return <Ban size={14} />;
  return categoryConfig[category]?.icon || <Circle size={14} />;
}

function getColumnColor(stateName: string, category: string): string {
  if (stateName === 'To Do') return '#eab308';
  if (stateName === 'Blocked') return '#ef4444';
  if (stateName === 'Resolved') return '#f97316';
  return categoryConfig[category]?.color || 'var(--text-muted)';
}

interface DroppableColumnProps {
  columnName: string;
  category: string;
  items: StandupWorkItem[];
  activeId: number | null;
}

function DroppableColumn({ columnName, category, items, activeId }: DroppableColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: columnName });
  const icon = getColumnIcon(columnName, category);
  const color = getColumnColor(columnName, category);

  return (
    <div className="kanban-column">
      <div className="kanban-column-header">
        <div className="flex items-center gap-2">
          <span style={{ color }}>{icon}</span>
          <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {columnName}
          </h4>
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

interface ProjectStandupSectionProps {
  project: ProjectStandupData;
  onStateChange?: (itemId: number, project: string, targetState: string) => Promise<void>;
}

export default function ProjectStandupSection({
  project,
  onStateChange,
}: ProjectStandupSectionProps) {
  const columnNames = useMemo(() => project.columns.map((c) => c.name), [project.columns]);
  const totalItems = useMemo(
    () => project.columns.reduce((sum, c) => sum + c.items.length, 0),
    [project.columns]
  );

  const [expanded, setExpanded] = useState(totalItems > 0);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Local state for drag-and-drop reactivity, keyed by column name
  const [localItems, setLocalItems] = useState<Record<string, StandupWorkItem[]>>(() => {
    const map: Record<string, StandupWorkItem[]> = {};
    for (const col of project.columns) {
      map[col.name] = col.items;
    }
    return map;
  });

  // Sync with prop changes (e.g. after refresh)
  useMemo(() => {
    const map: Record<string, StandupWorkItem[]> = {};
    for (const col of project.columns) {
      map[col.name] = col.items;
    }
    setLocalItems(map);
  }, [project.columns]);

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
      const { active, over } = event;
      setActiveId(null);

      if (!over || !onStateChange) return;

      const activeItemId = active.id as number;
      const targetCol = findColumn(activeItemId);
      if (!targetCol) return;

      // Find original column from props
      const originalCol = project.columns.find((c) => c.items.some((i) => i.id === activeItemId));
      if (originalCol?.name === targetCol) return; // No change

      setIsUpdating(true);
      try {
        // targetCol IS the DevOps state name — pass it directly
        await onStateChange(activeItemId, project.projectName, targetCol);
      } catch (error) {
        console.error('Failed to update state:', error);
        // Rollback
        const map: Record<string, StandupWorkItem[]> = {};
        for (const col of project.columns) {
          map[col.name] = col.items;
        }
        setLocalItems(map);
      } finally {
        setIsUpdating(false);
      }
    },
    [onStateChange, findColumn, project]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    const map: Record<string, StandupWorkItem[]> = {};
    for (const col of project.columns) {
      map[col.name] = col.items;
    }
    setLocalItems(map);
  }, [project.columns]);

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
          {project.projectName}
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
              {project.columns.map((col) => (
                <DroppableColumn
                  key={col.name}
                  columnName={col.name}
                  category={col.category}
                  items={localItems[col.name] || []}
                  activeId={activeId}
                />
              ))}
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
