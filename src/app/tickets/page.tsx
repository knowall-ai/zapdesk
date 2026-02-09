'use client';

import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense, useCallback } from 'react';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner } from '@/components/common';
import { TicketList } from '@/components/tickets';
import WorkItemDetailDialog from '@/components/tickets/WorkItemDetailDialog';
import ZapDialog from '@/components/tickets/ZapDialog';
import { useOrganization } from '@/components/providers/OrganizationProvider';
import type { Ticket, WorkItem, User, WorkItemType } from '@/types';

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
  const { selectedOrganization } = useOrganization();
  const view = searchParams.get('view') || 'all-unsolved';
  const displayParam = searchParams.get('display');
  const isKanbanView = view === 'kanban';

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [zapTarget, setZapTarget] = useState<{ agent: User; ticketId: number } | null>(null);
  const [workItemTypes, setWorkItemTypes] = useState<WorkItemType[]>([]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const fetchTickets = useCallback(async () => {
    if (!selectedOrganization) return;
    setLoading(true);
    try {
      // For kanban view, fetch all active tickets
      const fetchView = isKanbanView ? 'all-active' : view;
      const params = new URLSearchParams({ view: fetchView });
      const response = await fetch(`/api/devops/tickets?${params.toString()}`, {
        headers: { 'x-devops-org': selectedOrganization.accountName },
      });
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

        // Fetch work item types for type icons from the first project
        const firstProject = ticketsWithDates.find((t: Ticket) => t.project)?.project;
        if (firstProject) {
          fetch(`/api/devops/projects/${encodeURIComponent(firstProject)}/workitemtypes`, {
            headers: { 'x-devops-org': selectedOrganization.accountName },
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              if (d) setWorkItemTypes(d.types || []);
            })
            .catch(() => {});
        }
      }
    } catch (error) {
      console.error('Failed to fetch tickets:', error);
    } finally {
      setLoading(false);
    }
  }, [view, isKanbanView, selectedOrganization]);

  useEffect(() => {
    if (session?.accessToken) {
      fetchTickets();
    }
  }, [session, fetchTickets]);

  const handleTicketStateChange = useCallback(
    async (ticketId: number, newState: string) => {
      try {
        const response = await fetch(`/api/devops/tickets/${ticketId}/state`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(selectedOrganization && {
              'x-devops-org': selectedOrganization.accountName,
            }),
          },
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
    },
    [selectedOrganization]
  );

  // Convert a Ticket to a WorkItem shape for the detail dialog
  const ticketToWorkItem = useCallback((ticket: Ticket): WorkItem => {
    return {
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      state: ticket.devOpsState,
      workItemType: ticket.workItemType,
      areaPath: '',
      project: ticket.project,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      completedWork: 0,
      remainingWork: 0,
      originalEstimate: 0,
      assignee: ticket.assignee,
      devOpsUrl: ticket.devOpsUrl,
      tags: ticket.tags,
      priority: ticket.priority,
      requester: ticket.requester,
      organization: ticket.organization,
    };
  }, []);

  const handleWorkItemClick = useCallback(
    (item: WorkItem) => {
      // Find the full ticket from our state
      const ticket = tickets.find((t) => t.id === item.id);
      if (ticket) {
        setSelectedTicket(ticket);
      }
    },
    [tickets]
  );

  const handleDialogStateChange = useCallback(
    async (workItemId: number, state: string) => {
      await handleTicketStateChange(workItemId, state);
      // Update the selected ticket's state in the dialog
      setSelectedTicket((prev) => (prev ? { ...prev, devOpsState: state } : null));
    },
    [handleTicketStateChange]
  );

  const handleZapClick = useCallback((item: WorkItem) => {
    if (item.assignee) {
      setZapTarget({ agent: item.assignee, ticketId: item.id });
    }
  }, []);

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
  const defaultViewMode = isKanbanView || displayParam === 'kanban' ? 'kanban' : 'list';

  return (
    <MainLayout>
      <div className="flex h-full flex-col">
        {/* TicketList renders WorkItemBoard with built-in filters, group-by, and view toggle */}
        <div className="flex-1 overflow-hidden">
          <TicketList
            tickets={tickets}
            title={title}
            onWorkItemClick={handleWorkItemClick}
            onZapClick={handleZapClick}
            onStatusChange={handleTicketStateChange}
            availableTypes={workItemTypes}
            defaultViewMode={defaultViewMode}
            hideTicketsOnlyToggle
          />
        </div>

        {/* Work item detail dialog for list and kanban clicks */}
        <WorkItemDetailDialog
          workItem={selectedTicket ? ticketToWorkItem(selectedTicket) : null}
          isOpen={!!selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onStateChange={handleDialogStateChange}
        />

        {/* Zap dialog for lightning tips from list/kanban views */}
        {zapTarget && (
          <ZapDialog
            isOpen={!!zapTarget}
            onClose={() => setZapTarget(null)}
            agent={zapTarget.agent}
            ticketId={zapTarget.ticketId}
          />
        )}
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
