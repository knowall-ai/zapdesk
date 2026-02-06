'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import KanbanColumn from './KanbanColumn';
import KanbanCard from './KanbanCard';
import type { Ticket, WorkItem, WorkItemState } from '@/types';
import { ensureActiveState } from '@/types';

// KanbanBoard can work with either Ticket[] or WorkItem[]
// WorkItem uses 'state' while Ticket uses 'devOpsState' for the state name
type KanbanItem = Ticket | WorkItem;

interface KanbanBoardProps {
  tickets?: Ticket[];
  items?: WorkItem[]; // Alternative prop for WorkItem[]
  onTicketStateChange?: (ticketId: number, newState: string) => Promise<void>;
  readOnly?: boolean; // Disable drag-and-drop
}

// Helper to get state from either Ticket or WorkItem
function getItemState(item: KanbanItem): string {
  if ('devOpsState' in item) {
    return item.devOpsState;
  }
  return item.state;
}

// Helper to create updated item with new state
function setItemState<T extends KanbanItem>(item: T, newState: string): T {
  if ('devOpsState' in item) {
    return { ...item, devOpsState: newState } as T;
  }
  return { ...item, state: newState } as T;
}

export default function KanbanBoard({
  tickets,
  items,
  onTicketStateChange,
  readOnly = false,
}: KanbanBoardProps) {
  // Use items if provided, otherwise fall back to tickets
  // Wrapped in useMemo to prevent reference changes on every render
  const sourceItems = useMemo<KanbanItem[]>(() => items || tickets || [], [items, tickets]);
  const [localItems, setLocalItems] = useState<KanbanItem[]>(sourceItems);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [kanbanStates, setKanbanStates] = useState<WorkItemState[]>([]);
  const [isLoadingStates, setIsLoadingStates] = useState(true);

  // Fetch work item states from API
  useEffect(() => {
    async function fetchStates() {
      try {
        const response = await fetch('/api/devops/workitem-states');
        if (response.ok) {
          const data = await response.json();
          if (data.allStates && data.allStates.length > 0) {
            // Use shared utility to ensure "Active" state exists
            const states = ensureActiveState(data.allStates);
            setKanbanStates(states);
          }
        }
      } catch (error) {
        console.error('Failed to fetch work item states:', error);
      } finally {
        setIsLoadingStates(false);
      }
    }
    fetchStates();
  }, []);

  // Update local items when props change
  useEffect(() => {
    setLocalItems(sourceItems);
  }, [sourceItems]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Group items by their state and track unrecognized states
  const { itemsByState, itemsWithUnrecognizedState } = useMemo(() => {
    const grouped: Record<string, KanbanItem[]> = {};
    const unrecognizedItemIds = new Set<number>();

    // Initialize all state columns
    kanbanStates.forEach((state) => {
      grouped[state.name] = [];
    });

    // Track unmatched states
    const unmatchedStates = new Set<string>();

    // Group items by their state
    localItems.forEach((item) => {
      const state = getItemState(item);
      if (grouped[state]) {
        grouped[state].push(item);
      } else {
        // Track items with states not in our columns
        unmatchedStates.add(state);
        unrecognizedItemIds.add(item.id);
        // Put them in the first column (usually "New") as fallback
        const firstColumn = kanbanStates[0]?.name;
        if (firstColumn && grouped[firstColumn]) {
          grouped[firstColumn].push(item);
        }
      }
    });

    // Log any unmatched states for debugging
    if (unmatchedStates.size > 0) {
      console.warn(
        '[KanbanBoard] Items with unrecognized states placed in first column:',
        Array.from(unmatchedStates)
      );
    }

    return { itemsByState: grouped, itemsWithUnrecognizedState: unrecognizedItemIds };
  }, [localItems, kanbanStates]);

  const activeItem = useMemo(() => {
    if (!activeId) return null;
    return localItems.find((t) => t.id === activeId) || null;
  }, [activeId, localItems]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as number);
  }, []);

  // Get list of state names for checking if dropping on a column
  const stateNames = useMemo(() => kanbanStates.map((s) => s.name), [kanbanStates]);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeItemId = active.id as number;
      const overId = over.id as string;

      // Find the item being dragged
      const item = localItems.find((t) => t.id === activeItemId);
      if (!item) return;

      // Determine the target state
      let targetState: string | null = null;

      // Check if we're over a column (state name)
      if (stateNames.includes(overId)) {
        targetState = overId;
      } else {
        // We're over another item - find its state
        const overItem = localItems.find((t) => t.id === Number(overId));
        if (overItem) {
          targetState = getItemState(overItem);
        }
      }

      // If moving to a different state, update locally for visual feedback
      if (targetState && getItemState(item) !== targetState) {
        setLocalItems((prev) =>
          prev.map((t) => (t.id === activeItemId ? setItemState(t, targetState!) : t))
        );
      }
    },
    [localItems, stateNames]
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (!over) return;

      const activeItemId = active.id as number;
      const overId = over.id as string;

      // Find the original item (from props, not local state)
      const originalItem = sourceItems.find((t) => t.id === activeItemId);
      if (!originalItem) return;

      // Determine the target state
      let targetState: string | null = null;

      if (stateNames.includes(overId)) {
        targetState = overId;
      } else {
        const overItem = localItems.find((t) => t.id === Number(overId));
        if (overItem) {
          targetState = getItemState(overItem);
        }
      }

      // If state hasn't changed, reset to original
      if (!targetState || getItemState(originalItem) === targetState) {
        setLocalItems(sourceItems);
        return;
      }

      // Persist the state change
      if (onTicketStateChange) {
        setIsUpdating(true);
        try {
          await onTicketStateChange(activeItemId, targetState);
        } catch (error) {
          console.error('Failed to update item state:', error);
          // Rollback on failure
          setLocalItems(sourceItems);
        } finally {
          setIsUpdating(false);
        }
      }
    },
    [sourceItems, localItems, onTicketStateChange, stateNames]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setLocalItems(sourceItems);
  }, [sourceItems]);

  if (isLoadingStates) {
    return (
      <div className="kanban-board flex items-center justify-center p-8">
        <div className="text-[var(--text-muted)]">Loading board...</div>
      </div>
    );
  }

  // Render columns content (shared between readOnly and interactive modes)
  const columnsContent = (
    <div className="kanban-columns">
      {kanbanStates.map((state) => (
        <KanbanColumn
          key={state.name}
          stateName={state.name}
          stateColor={state.color}
          items={itemsByState[state.name] || []}
          activeId={readOnly ? null : activeId}
          itemsWithUnrecognizedState={itemsWithUnrecognizedState}
          readOnly={readOnly}
        />
      ))}
    </div>
  );

  // ReadOnly mode: just render columns without drag-and-drop
  if (readOnly) {
    return <div className="kanban-board">{columnsContent}</div>;
  }

  // Interactive mode: wrap with DndContext for drag-and-drop
  return (
    <div className="kanban-board">
      {isUpdating && (
        <div className="fixed top-4 right-4 z-50 rounded-md bg-[var(--primary)] px-4 py-2 text-sm text-white shadow-lg">
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
        {columnsContent}

        <DragOverlay>{activeItem ? <KanbanCard item={activeItem} isDragging /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
