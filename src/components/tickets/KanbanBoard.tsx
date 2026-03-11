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

  useEffect(() => {
    async function fetchStates() {
      try {
        const response = await fetch('/api/devops/workitem-states');
        if (response.ok) {
          const data = await response.json();
          if (data.allStates && data.allStates.length > 0) {
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

  useEffect(() => {
    setLocalTickets(tickets);
  }, [tickets]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const { ticketsByState, ticketsWithUnrecognizedState } = useMemo(() => {
    const grouped: Record<string, Ticket[]> = {};
    const unrecognizedTicketIds = new Set<number>();

    kanbanStates.forEach((state) => {
      grouped[state.name] = [];
    });

    const unmatchedStates = new Set<string>();

    localTickets.forEach((ticket) => {
      const state = ticket.devOpsState;
      if (grouped[state]) {
        grouped[state].push(ticket);
      } else {
        unmatchedStates.add(state);
        unrecognizedTicketIds.add(ticket.id);
        const firstColumn = kanbanStates[0]?.name;
        if (firstColumn && grouped[firstColumn]) {
          grouped[firstColumn].push(ticket);
        }
      }
    });

    if (unmatchedStates.size > 0) {
      console.warn(
        '[KanbanBoard] Tickets with unrecognized states placed in first column:',
        Array.from(unmatchedStates)
      );
    }

    return { ticketsByState: grouped, ticketsWithUnrecognizedState: unrecognizedTicketIds };
  }, [localTickets, kanbanStates]);

  const activeTicket = useMemo(() => {
    if (!activeId) return null;
    return localTickets.find((t) => t.id === activeId) || null;
  }, [activeId, localTickets]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as number);
  }, []);

  const stateNames = useMemo(() => kanbanStates.map((s) => s.name), [kanbanStates]);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeTicketId = active.id as number;
      const overId = over.id as string;

      const ticket = localTickets.find((t) => t.id === activeTicketId);
      if (!ticket) return;

      let targetState: string | null = null;

      if (stateNames.includes(overId)) {
        targetState = overId;
      } else {
        const overTicket = localTickets.find((t) => t.id === Number(overId));
        if (overTicket) {
          targetState = overTicket.devOpsState;
        }
      }

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

      const originalTicket = tickets.find((t) => t.id === activeTicketId);
      if (!originalTicket) return;

      let targetState: string | null = null;

      if (stateNames.includes(overId)) {
        targetState = overId;
      } else {
        const overTicket = localTickets.find((t) => t.id === Number(overId));
        if (overTicket) {
          targetState = overTicket.devOpsState;
        }
      }

      if (!targetState || originalTicket.devOpsState === targetState) {
        setLocalTickets(tickets);
        return;
      }

      if (onTicketStateChange) {
        setIsUpdating(true);
        try {
          await onTicketStateChange(activeTicketId, targetState);
        } catch (error) {
          console.error('Failed to update ticket state:', error);
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
          {kanbanStates.map((state) => {
            const columnTickets = ticketsByState[state.name] || [];
            return (
              <KanbanColumn
                key={state.name}
                id={state.name}
                label={state.name}
                color={state.color ? `#${state.color}` : 'var(--text-muted)'}
                count={columnTickets.length}
                itemIds={columnTickets.map((t) => t.id)}
                emptyText="No tickets"
              >
                {columnTickets.map((ticket) => (
                  <KanbanCard
                    key={ticket.id}
                    ticket={ticket}
                    isDragging={activeId === ticket.id}
                    hasUnrecognizedState={ticketsWithUnrecognizedState.has(ticket.id)}
                  />
                ))}
              </KanbanColumn>
            );
          })}
        </div>

        <DragOverlay>
          {activeTicket ? <KanbanCard ticket={activeTicket} isDragging /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
