'use client';

import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense, useCallback } from 'react';
import { List, LayoutGrid } from 'lucide-react';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner } from '@/components/common';
import { TicketList, KanbanBoard } from '@/components/tickets';
import type { Ticket, TicketStatus } from '@/types';

const viewTitles: Record<string, string> = {
  'your-active': 'Your active tickets',
  rated: 'Rated tickets from the last 7 days',
  unassigned: 'Unassigned tickets',
  'all-active': 'All active tickets',
  'recently-updated': 'Recently updated tickets',
  'created-today': 'Created today',
  pending: 'Pending tickets',
  'recently-solved': 'Recently solved tickets',
  removed: 'Removed tickets',
  kanban: 'Kanban Board',
};

function TicketsPageContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get('view') || 'all-unsolved';
  const isKanbanView = view === 'kanban';

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [displayMode, setDisplayMode] = useState<'list' | 'kanban'>(
    isKanbanView ? 'kanban' : 'list'
  );

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  // Update display mode when navigating to kanban view
  useEffect(() => {
    if (isKanbanView) {
      setDisplayMode('kanban');
    }
  }, [isKanbanView]);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      // For kanban view, fetch all active tickets
      const fetchView = isKanbanView ? 'all-active' : view;
      const response = await fetch(`/api/devops/tickets?view=${fetchView}`);
      if (response.ok) {
        const data = await response.json();
        // Convert date strings to Date objects
        const ticketsWithDates = data.tickets.map(
          (t: Ticket & { createdAt: string; updatedAt: string }) => ({
            ...t,
            createdAt: new Date(t.createdAt),
            updatedAt: new Date(t.updatedAt),
          })
        );
        setTickets(ticketsWithDates);
      }
    } catch (error) {
      console.error('Failed to fetch tickets:', error);
    } finally {
      setLoading(false);
    }
  }, [view, isKanbanView]);

  useEffect(() => {
    if (session?.accessToken) {
      fetchTickets();
    }
  }, [session, fetchTickets]);

  const handleTicketStatusChange = useCallback(
    async (ticketId: number, newStatus: TicketStatus) => {
      try {
        const response = await fetch(`/api/devops/tickets/${ticketId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });

        if (!response.ok) {
          throw new Error('Failed to update status');
        }

        // Update local state with the new status
        setTickets((prev) =>
          prev.map((t) => (t.id === ticketId ? { ...t, status: newStatus } : t))
        );
      } catch (error) {
        console.error('Failed to update ticket status:', error);
        throw error; // Re-throw so KanbanBoard can handle rollback
      }
    },
    []
  );

  if (status === 'loading' || loading) {
    return (
      <MainLayout>
        <div className="flex h-full items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </MainLayout>
    );
  }

  if (!session) {
    return null;
  }

  const title = viewTitles[view] || 'Tickets';

  return (
    <MainLayout>
      <div className="flex h-full flex-col">
        {/* Header with view toggle */}
        <div
          className="flex items-center justify-between border-b px-6 py-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">{title}</h1>

          <div className="flex items-center gap-1 rounded-lg bg-[var(--surface)] p-1">
            <button
              onClick={() => setDisplayMode('list')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                displayMode === 'list'
                  ? 'bg-[var(--primary)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
              title="List view"
            >
              <List size={16} />
              <span className="hidden sm:inline">List</span>
            </button>
            <button
              onClick={() => setDisplayMode('kanban')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                displayMode === 'kanban'
                  ? 'bg-[var(--primary)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
              title="Kanban view"
            >
              <LayoutGrid size={16} />
              <span className="hidden sm:inline">Kanban</span>
            </button>
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-hidden">
          {displayMode === 'list' ? (
            <TicketList tickets={tickets} title="" />
          ) : (
            <KanbanBoard tickets={tickets} onTicketStatusChange={handleTicketStatusChange} />
          )}
        </div>
      </div>
    </MainLayout>
  );
}

export default function TicketsPage() {
  return (
    <Suspense
      fallback={
        <MainLayout>
          <div className="flex h-full items-center justify-center">
            <LoadingSpinner size="lg" />
          </div>
        </MainLayout>
      }
    >
      <TicketsPageContent />
    </Suspense>
  );
}
