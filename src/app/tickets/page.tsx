'use client';

import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense, useCallback, useMemo } from 'react';
import { List, LayoutGrid, X } from 'lucide-react';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner } from '@/components/common';
import { TicketList, KanbanBoard } from '@/components/tickets';
import type { Ticket, TicketStatus, TicketPriority } from '@/types';

interface Filters {
  status: TicketStatus | '';
  priority: TicketPriority | '';
  assignee: string;
  requester: string;
}

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
  const [filters, setFilters] = useState<Filters>({
    status: '',
    priority: '',
    assignee: '',
    requester: '',
  });

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

  const handleTicketStateChange = useCallback(async (ticketId: number, newState: string) => {
    try {
      const response = await fetch(`/api/devops/tickets/${ticketId}/state`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: newState }),
      });

      if (!response.ok) {
        throw new Error('Failed to update state');
      }

      // Update local state with the new DevOps state
      setTickets((prev) =>
        prev.map((t) => (t.id === ticketId ? { ...t, devOpsState: newState } : t))
      );
    } catch (error) {
      console.error('Failed to update ticket state:', error);
      throw error; // Re-throw so KanbanBoard can handle rollback
    }
  }, []);

  // Get unique values for filter dropdowns
  const filterOptions = useMemo(() => {
    const assignees = new Set<string>();
    const requesters = new Set<string>();

    tickets.forEach((ticket) => {
      if (ticket.assignee?.displayName) {
        assignees.add(ticket.assignee.displayName);
      }
      if (ticket.requester?.displayName) {
        requesters.add(ticket.requester.displayName);
      }
    });

    return {
      assignees: Array.from(assignees).sort(),
      requesters: Array.from(requesters).sort(),
    };
  }, [tickets]);

  // Apply filters
  const filteredTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      if (filters.status && ticket.status !== filters.status) return false;
      if (filters.priority && ticket.priority !== filters.priority) return false;
      if (filters.assignee && ticket.assignee?.displayName !== filters.assignee) return false;
      if (filters.requester && ticket.requester.displayName !== filters.requester) return false;
      return true;
    });
  }, [tickets, filters]);

  const clearFilters = () => {
    setFilters({ status: '', priority: '', assignee: '', requester: '' });
  };

  const hasActiveFilters =
    filters.status || filters.priority || filters.assignee || filters.requester;

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
        {/* Header */}
        <div className="border-b px-6 py-4" style={{ borderColor: 'var(--border)' }}>
          <div className="mb-3 flex items-center justify-between">
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">{title}</h1>
          </div>

          {/* Filters and view toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {filteredTickets.length} ticket{filteredTickets.length !== 1 ? 's' : ''}
              {hasActiveFilters && ` (filtered from ${tickets.length})`}
            </span>

            <div className="flex flex-wrap items-center gap-3">
              <select
                value={filters.status}
                onChange={(e) =>
                  setFilters({ ...filters, status: e.target.value as TicketStatus | '' })
                }
                className="input text-sm"
              >
                <option value="">All Statuses</option>
                <option value="New">New</option>
                <option value="Open">Open</option>
                <option value="In Progress">In Progress</option>
                <option value="Pending">Pending</option>
                <option value="Resolved">Resolved</option>
                <option value="Closed">Closed</option>
              </select>

              <select
                value={filters.priority}
                onChange={(e) =>
                  setFilters({ ...filters, priority: e.target.value as TicketPriority | '' })
                }
                className="input text-sm"
              >
                <option value="">All Priorities</option>
                <option value="Urgent">Urgent</option>
                <option value="High">High</option>
                <option value="Normal">Normal</option>
                <option value="Low">Low</option>
              </select>

              <select
                value={filters.assignee}
                onChange={(e) => setFilters({ ...filters, assignee: e.target.value })}
                className="input text-sm"
              >
                <option value="">All Assignees</option>
                {filterOptions.assignees.map((assignee) => (
                  <option key={assignee} value={assignee}>
                    {assignee}
                  </option>
                ))}
              </select>

              <select
                value={filters.requester}
                onChange={(e) => setFilters({ ...filters, requester: e.target.value })}
                className="input text-sm"
              >
                <option value="">All Requesters</option>
                {filterOptions.requesters.map((requester) => (
                  <option key={requester} value={requester}>
                    {requester}
                  </option>
                ))}
              </select>

              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1 rounded px-2 py-1 text-sm transition-colors hover:bg-[var(--surface-hover)]"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <X size={14} />
                  Clear
                </button>
              )}

              {/* View toggle */}
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
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-hidden">
          {displayMode === 'list' ? (
            <TicketList tickets={filteredTickets} title="" hideFilters />
          ) : (
            <KanbanBoard tickets={filteredTickets} onTicketStateChange={handleTicketStateChange} />
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
