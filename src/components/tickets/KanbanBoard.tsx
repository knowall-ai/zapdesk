'use client';

import { useState, useCallback, useMemo } from 'react';
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
import type { Ticket, TicketStatus } from '@/types';

interface KanbanBoardProps {
  tickets: Ticket[];
  onTicketStatusChange?: (ticketId: number, newStatus: TicketStatus) => Promise<void>;
}

const KANBAN_STATUSES: TicketStatus[] = [
  'New',
  'Open',
  'In Progress',
  'Pending',
  'Resolved',
  'Closed',
];

export default function KanbanBoard({ tickets, onTicketStatusChange }: KanbanBoardProps) {
  const [localTickets, setLocalTickets] = useState<Ticket[]>(tickets);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Update local tickets when props change
  useMemo(() => {
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

  const ticketsByStatus = useMemo(() => {
    const grouped: Record<TicketStatus, Ticket[]> = {
      New: [],
      Open: [],
      'In Progress': [],
      Pending: [],
      Resolved: [],
      Closed: [],
    };

    localTickets.forEach((ticket) => {
      if (grouped[ticket.status]) {
        grouped[ticket.status].push(ticket);
      }
    });

    return grouped;
  }, [localTickets]);

  const activeTicket = useMemo(() => {
    if (!activeId) return null;
    return localTickets.find((t) => t.id === activeId) || null;
  }, [activeId, localTickets]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as number);
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeTicketId = active.id as number;
      const overId = over.id;

      // Find the ticket being dragged
      const ticket = localTickets.find((t) => t.id === activeTicketId);
      if (!ticket) return;

      // Determine the target status
      let targetStatus: TicketStatus | null = null;

      // Check if we're over a column (status)
      if (KANBAN_STATUSES.includes(overId as TicketStatus)) {
        targetStatus = overId as TicketStatus;
      } else {
        // We're over another ticket - find its status
        const overTicket = localTickets.find((t) => t.id === overId);
        if (overTicket) {
          targetStatus = overTicket.status;
        }
      }

      // If moving to a different status, update locally for visual feedback
      if (targetStatus && ticket.status !== targetStatus) {
        setLocalTickets((prev) =>
          prev.map((t) => (t.id === activeTicketId ? { ...t, status: targetStatus } : t))
        );
      }
    },
    [localTickets]
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (!over) return;

      const activeTicketId = active.id as number;
      const overId = over.id;

      // Find the original ticket (from props, not local state)
      const originalTicket = tickets.find((t) => t.id === activeTicketId);
      if (!originalTicket) return;

      // Determine the target status
      let targetStatus: TicketStatus | null = null;

      if (KANBAN_STATUSES.includes(overId as TicketStatus)) {
        targetStatus = overId as TicketStatus;
      } else {
        const overTicket = localTickets.find((t) => t.id === overId);
        if (overTicket) {
          targetStatus = overTicket.status;
        }
      }

      // If status hasn't changed, reset to original
      if (!targetStatus || originalTicket.status === targetStatus) {
        setLocalTickets(tickets);
        return;
      }

      // Persist the status change
      if (onTicketStatusChange) {
        setIsUpdating(true);
        try {
          await onTicketStatusChange(activeTicketId, targetStatus);
        } catch (error) {
          console.error('Failed to update ticket status:', error);
          // Rollback on failure
          setLocalTickets(tickets);
        } finally {
          setIsUpdating(false);
        }
      }
    },
    [tickets, localTickets, onTicketStatusChange]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setLocalTickets(tickets);
  }, [tickets]);

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
          {KANBAN_STATUSES.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              tickets={ticketsByStatus[status]}
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
