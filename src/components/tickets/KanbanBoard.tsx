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
import type { Ticket, WorkItemState } from '@/types';
import { ensureActiveState } from '@/types';

interface KanbanBoardProps {
  tickets: Ticket[];
  onTicketStateChange?: (ticketId: number, newState: string) => Promise<void>;
}

export default function KanbanBoard({ tickets, onTicketStateChange }: KanbanBoardProps) {
  const [localTickets, setLocalTickets] = useState<Ticket[]>(tickets);
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

  // Update local tickets when props change
  useEffect(() => {
    setLocalTickets(tickets);
  }, [tickets]);

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

  // Group tickets by their original DevOps state
  const ticketsByState = useMemo(() => {
    const grouped: Record<string, Ticket[]> = {};

    // Initialize all state columns
    kanbanStates.forEach((state) => {
      grouped[state.name] = [];
    });

    // Track unmatched states
    const unmatchedStates = new Set<string>();

    // Group tickets by their DevOps state
    localTickets.forEach((ticket) => {
      const state = ticket.devOpsState;
      if (grouped[state]) {
        grouped[state].push(ticket);
      } else {
        // Track tickets with states not in our columns
        unmatchedStates.add(state);
        // Put them in the first column (usually "New") as fallback
        const firstColumn = kanbanStates[0]?.name;
        if (firstColumn && grouped[firstColumn]) {
          grouped[firstColumn].push(ticket);
        }
      }
    });

    // Log any unmatched states for debugging
    if (unmatchedStates.size > 0) {
      console.warn(
        '[KanbanBoard] Tickets with unrecognized states placed in first column:',
        Array.from(unmatchedStates)
      );
    }

    return grouped;
  }, [localTickets, kanbanStates]);

  const activeTicket = useMemo(() => {
    if (!activeId) return null;
    return localTickets.find((t) => t.id === activeId) || null;
  }, [activeId, localTickets]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as number);
  }, []);

  // Get list of state names for checking if dropping on a column
  const stateNames = useMemo(() => kanbanStates.map((s) => s.name), [kanbanStates]);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeTicketId = active.id as number;
      const overId = over.id as string;

      // Find the ticket being dragged
      const ticket = localTickets.find((t) => t.id === activeTicketId);
      if (!ticket) return;

      // Determine the target state (DevOps state name)
      let targetState: string | null = null;

      // Check if we're over a column (state name)
      if (stateNames.includes(overId)) {
        targetState = overId;
      } else {
        // We're over another ticket - find its DevOps state
        const overTicket = localTickets.find((t) => t.id === Number(overId));
        if (overTicket) {
          targetState = overTicket.devOpsState;
        }
      }

      // If moving to a different state, update locally for visual feedback
      if (targetState && ticket.devOpsState !== targetState) {
        setLocalTickets((prev) =>
          prev.map((t) => (t.id === activeTicketId ? { ...t, devOpsState: targetState } : t))
        );
      }
    },
    [localTickets, stateNames]
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (!over) return;

      const activeTicketId = active.id as number;
      const overId = over.id as string;

      // Find the original ticket (from props, not local state)
      const originalTicket = tickets.find((t) => t.id === activeTicketId);
      if (!originalTicket) return;

      // Determine the target state (DevOps state name)
      let targetState: string | null = null;

      if (stateNames.includes(overId)) {
        targetState = overId;
      } else {
        const overTicket = localTickets.find((t) => t.id === Number(overId));
        if (overTicket) {
          targetState = overTicket.devOpsState;
        }
      }

      // If state hasn't changed, reset to original
      if (!targetState || originalTicket.devOpsState === targetState) {
        setLocalTickets(tickets);
        return;
      }

      // Persist the state change
      if (onTicketStateChange) {
        setIsUpdating(true);
        try {
          await onTicketStateChange(activeTicketId, targetState);
        } catch (error) {
          console.error('Failed to update ticket state:', error);
          // Rollback on failure
          setLocalTickets(tickets);
        } finally {
          setIsUpdating(false);
        }
      }
    },
    [tickets, localTickets, onTicketStateChange, stateNames]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setLocalTickets(tickets);
  }, [tickets]);

  if (isLoadingStates) {
    return (
      <div className="kanban-board flex items-center justify-center p-8">
        <div className="text-[var(--text-muted)]">Loading board...</div>
      </div>
    );
  }

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
        <div className="kanban-columns">
          {kanbanStates.map((state) => (
            <KanbanColumn
              key={state.name}
              stateName={state.name}
              stateColor={state.color}
              tickets={ticketsByState[state.name] || []}
              activeId={activeId}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTicket ? <KanbanCard ticket={activeTicket} isDragging /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
