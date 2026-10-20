'use client';

import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { loginHref } from '@/lib/login-redirect';
import { useEffect, useRef, useState, Suspense, useCallback } from 'react';
import { toast } from 'sonner';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner } from '@/components/common';
import { TicketList } from '@/components/tickets';
import WorkItemDetailDialog from '@/components/tickets/WorkItemDetailDialog';
import ZapDialog from '@/components/tickets/ZapDialog';
import { useOrganization } from '@/components/providers/OrganizationProvider';
import { useTicketCounts } from '@/components/providers/TicketCountsProvider';
import { useSourceFilter } from '@/components/providers/SourceProvider';
import { ticketToWorkItem } from '@/lib/devops';
import type { Ticket, WorkItem, User, WorkItemType, EffortHoursUpdate } from '@/types';

type TicketJson = Ticket & { createdAt: string; updatedAt: string };

/** Dates arrive as strings over JSON. */
function reviveTicketDates(tickets: TicketJson[]): Ticket[] {
  return tickets.map((t) => ({
    ...t,
    createdAt: new Date(t.createdAt),
    updatedAt: new Date(t.updatedAt),
  }));
}

const viewTitles: Record<string, string> = {
  'your-active': 'Your active tickets',
  unassigned: 'Unassigned tickets',
  'all-active': 'All active tickets',
  'recently-updated': 'Recently updated tickets',
  'created-today': 'Created today',
  pending: 'Pending tickets',
  'recently-solved': 'Recently solved tickets',
  removed: 'Removed tickets',
  kanban: 'Kanban Board',
};

/** The tickets list or Kanban view for the selected sidebar view. */
function TicketsPageContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedOrganization } = useOrganization();
  const { refresh: refreshCounts } = useTicketCounts();
  const { sourceFilter, gitHubConfigured, sourceReady } = useSourceFilter();
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
      router.push(loginHref());
    }
  }, [status, router]);

  // Monotonic request id. Change the view, the organization or the source
  // toggle while a load is in flight and the old one can still answer last;
  // without this it would put its tickets under the newer selection.
  const fetchSeqRef = useRef(0);

  const fetchTickets = useCallback(async () => {
    if (!selectedOrganization) return;
    const mySeq = ++fetchSeqRef.current;
    /** False once a later load has started; nothing from this one may show then. */
    const isCurrent = () => mySeq === fetchSeqRef.current;
    setLoading(true);
    try {
      // For kanban view, fetch all active tickets
      const fetchView = isKanbanView ? 'all-active' : view;
      const params = new URLSearchParams({ view: fetchView });
      const headers = { 'x-devops-org': selectedOrganization.accountName };

      // The two sources load side by side and fail separately: GitHub being
      // down must not empty the DevOps list, or the other way round (#447).
      const [devOpsResult, gitHubResult] = await Promise.allSettled([
        sourceFilter === 'github'
          ? null
          : fetch(`/api/devops/tickets?${params.toString()}`, { headers }),
        sourceFilter === 'devops'
          ? null
          : fetch(`/api/github/issues?${params.toString()}`, { headers }),
      ]);

      if (!isCurrent()) return;

      // Read one source's answer. A source that fails, at the request or while
      // its body is read, is reported and counts as empty, so the tickets of
      // the other one are still shown.
      const readSource = async (
        result: PromiseSettledResult<Response | null>,
        failure: string
      ): Promise<{ tickets: Ticket[]; failedRepos: string[] }> => {
        const nothing = { tickets: [], failedRepos: [] };
        // Not asked for: the source toggle left this one out
        if (result.status === 'fulfilled' && !result.value) return nothing;
        try {
          if (result.status === 'rejected') throw result.reason;
          if (!result.value?.ok) throw new Error(`HTTP ${result.value?.status}`);
          const data = await result.value.json();
          return {
            tickets: reviveTicketDates(data.tickets || []),
            failedRepos: data.failedRepos || [],
          };
        } catch (error) {
          console.error(`${failure}:`, error);
          // Say so: with the other source still listed, a missing half would
          // otherwise pass for "there are none".
          if (isCurrent()) toast.error(failure);
          return nothing;
        }
      };

      const [devOps, gitHub] = await Promise.all([
        readSource(devOpsResult, 'Could not load tickets from Azure DevOps'),
        readSource(gitHubResult, 'Could not load GitHub issues'),
      ]);
      const devOpsTickets = devOps.tickets;
      const gitHubTickets = gitHub.tickets;

      if (!isCurrent()) return;
      if (gitHub.failedRepos.length > 0) {
        toast.warning(`Could not load GitHub issues from ${gitHub.failedRepos.join(', ')}`);
      }
      setTickets([...devOpsTickets, ...gitHubTickets]);

      // Fetch work item types for type icons, filtered to only ticket types
      const ticketTypeNames = new Set(devOpsTickets.map((t) => t.workItemType).filter(Boolean));
      const firstProject = devOpsTickets.find((t) => t.project)?.project;
      if (firstProject) {
        fetch(`/api/devops/projects/${encodeURIComponent(firstProject)}/workitemtypes`, {
          headers,
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (d && isCurrent()) {
              // Only include types that appear in ticket data (excludes User Story, Feature, etc.)
              const types = (d.types || []).filter((t: { name: string }) =>
                ticketTypeNames.has(t.name)
              );
              setWorkItemTypes(types);
            }
          })
          .catch(() => {});
      } else {
        setWorkItemTypes([]);
      }
    } catch (error) {
      console.error('Failed to fetch tickets:', error);
    } finally {
      // A superseded load must not clear the spinner the current one set.
      if (isCurrent()) setLoading(false);
    }
  }, [view, isKanbanView, selectedOrganization, sourceFilter]);

  useEffect(() => {
    if (session?.accessToken && sourceReady) {
      fetchTickets();
    }
  }, [session, sourceReady, fetchTickets]);

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
        if (!response.ok) throw new Error('Failed to update state');
        setTickets((prev) =>
          prev.map((t) => (t.id === ticketId ? { ...t, devOpsState: newState } : t))
        );
        refreshCounts();
        toast.success(`Status updated to "${newState}"`);
      } catch (error) {
        console.error('Failed to update ticket state:', error);
        toast.error('Failed to update status');
        throw error; // Re-throw so KanbanBoard can handle rollback
      }
    },
    [selectedOrganization, refreshCounts]
  );

  const handleWorkItemClick = useCallback(
    (item: WorkItem) => {
      // Find the full ticket from our state
      const ticket = tickets.find((t) => t.id === item.id);
      if (!ticket) return;
      // A GitHub issue has no ZapDesk detail view; its page on GitHub is the detail.
      if (ticket.source === 'github') {
        if (ticket.sourceUrl) window.open(ticket.sourceUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      setSelectedTicket(ticket);
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

  const handleDialogAssigneeChange = useCallback(
    async (workItemId: number, assigneeId: string | null) => {
      const ticket = tickets.find((t) => t.id === workItemId);
      if (!ticket || !selectedOrganization) return;
      try {
        const response = await fetch(`/api/devops/tickets/${workItemId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-devops-org': selectedOrganization.accountName,
          },
          body: JSON.stringify({ assignee: assigneeId, project: ticket.project }),
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error('Assignee change failed:', response.status, errorData);
          throw new Error('Failed to update assignee');
        }
        const data = await response.json();
        const updatedTicket = data.ticket;
        if (updatedTicket) {
          setTickets((prev) => prev.map((t) => (t.id === updatedTicket.id ? updatedTicket : t)));
          setSelectedTicket((prev) =>
            prev && prev.id === updatedTicket.id ? updatedTicket : prev
          );
        }
        refreshCounts();
        toast.success('Assignee updated');
      } catch (error) {
        console.error('Failed to update assignee:', error);
        toast.error('Failed to update assignee');
        throw error;
      }
    },
    [tickets, selectedOrganization, refreshCounts]
  );

  // Effort hours (#7728). Saved here, like the other fields, so the list row
  // and the open dialog both take the saved values.
  const handleDialogEffortChange = useCallback(
    async (workItemId: number, hours: EffortHoursUpdate) => {
      const ticket = tickets.find((t) => t.id === workItemId);
      if (!ticket || !selectedOrganization) return;
      try {
        const response = await fetch(`/api/devops/tickets/${workItemId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-devops-org': selectedOrganization.accountName,
          },
          body: JSON.stringify({ ...hours, project: ticket.project }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to update hours');
        }
        const data = await response.json();
        const updated: Ticket | undefined = data.ticket;
        const applied = {
          completedWork: updated?.completedWork ?? hours.completedWork ?? ticket.completedWork,
          remainingWork: updated?.remainingWork ?? hours.remainingWork ?? ticket.remainingWork,
        };
        setTickets((prev) => prev.map((t) => (t.id === workItemId ? { ...t, ...applied } : t)));
        setSelectedTicket((prev) =>
          prev && prev.id === workItemId ? { ...prev, ...applied } : prev
        );
        toast.success('Hours updated');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to update hours');
        throw error;
      }
    },
    [tickets, selectedOrganization]
  );

  const handleDialogPriorityChange = useCallback(
    async (workItemId: number, priority: number) => {
      const ticket = tickets.find((t) => t.id === workItemId);
      if (!ticket || !selectedOrganization) return;
      try {
        const response = await fetch(`/api/devops/tickets/${workItemId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-devops-org': selectedOrganization.accountName,
          },
          body: JSON.stringify({ priority, project: ticket.project }),
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error('Priority change failed:', response.status, errorData);
          throw new Error('Failed to update priority');
        }
        const data = await response.json();
        const updatedTicket = data.ticket;
        if (updatedTicket) {
          setTickets((prev) => prev.map((t) => (t.id === updatedTicket.id ? updatedTicket : t)));
          setSelectedTicket((prev) =>
            prev && prev.id === updatedTicket.id ? updatedTicket : prev
          );
        }
        toast.success('Priority updated');
      } catch (error) {
        console.error('Failed to update priority:', error);
        toast.error('Failed to update priority');
        throw error;
      }
    },
    [tickets, selectedOrganization]
  );

  const handleDialogTypeChange = useCallback(
    async (workItemId: number, newType: string, additionalFields?: Record<string, string>) => {
      const ticket = tickets.find((t) => t.id === workItemId);
      if (!ticket || !selectedOrganization) return;
      try {
        const response = await fetch(`/api/devops/tickets/${workItemId}/type`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-devops-org': selectedOrganization.accountName,
          },
          body: JSON.stringify({ type: newType, project: ticket.project, additionalFields }),
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error('Type change failed:', response.status, errorData);
          throw new Error(errorData.error || 'Failed to update work item type');
        }
        const data = await response.json();
        const updatedTicket = data.ticket;
        if (updatedTicket) {
          setTickets((prev) => prev.map((t) => (t.id === updatedTicket.id ? updatedTicket : t)));
          setSelectedTicket((prev) =>
            prev && prev.id === updatedTicket.id ? updatedTicket : prev
          );
        } else {
          // Fallback: update just the type field
          setTickets((prev) =>
            prev.map((t) => (t.id === workItemId ? { ...t, workItemType: newType } : t))
          );
          setSelectedTicket((prev) => (prev ? { ...prev, workItemType: newType } : null));
        }
        toast.success(`Type changed to "${newType}"`);
      } catch (error) {
        console.error('Failed to change work item type:', error);
        toast.error(error instanceof Error ? error.message : 'Failed to change work item type');
        throw error;
      }
    },
    [tickets, selectedOrganization]
  );

  const handleZapClick = useCallback((item: WorkItem) => {
    if (item.assignee) {
      setZapTarget({ agent: item.assignee, ticketId: item.id });
    }
  }, []);

  const handleDialogTagsChange = useCallback(
    async (workItemId: number, tags: string[]) => {
      const ticket = tickets.find((t) => t.id === workItemId);
      if (!ticket || !selectedOrganization) return;
      try {
        const response = await fetch(`/api/devops/tickets/${workItemId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-devops-org': selectedOrganization.accountName,
          },
          body: JSON.stringify({ tags, project: ticket.project }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to update tags');
        }
        setTickets((prev) => prev.map((t) => (t.id === workItemId ? { ...t, tags } : t)));
        setSelectedTicket((prev) => (prev && prev.id === workItemId ? { ...prev, tags } : prev));
        toast.success('Tags updated');
      } catch (error) {
        console.error('Failed to update tags:', error);
        toast.error(error instanceof Error ? error.message : 'Failed to update tags');
        throw error;
      }
    },
    [tickets, selectedOrganization]
  );

  const handleWorkItemUpdate = useCallback(
    async (
      workItemId: number,
      updates: {
        title?: string;
        description?: string;
        resolution?: string;
        mitigation?: string;
      }
    ) => {
      const ticket = tickets.find((t) => t.id === workItemId);
      if (!ticket || !selectedOrganization) return;
      try {
        const response = await fetch(`/api/devops/tickets/${workItemId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-devops-org': selectedOrganization.accountName,
          },
          body: JSON.stringify({
            ...updates,
            project: ticket.project,
            workItemType: ticket.workItemType,
          }),
        });
        if (!response.ok) throw new Error('Failed to update work item');
        const applied: Partial<Ticket> = {};
        if (updates.title !== undefined) applied.title = updates.title;
        if (updates.description !== undefined) applied.description = updates.description;
        if (updates.resolution !== undefined) applied.resolution = updates.resolution;
        if (updates.mitigation !== undefined) applied.mitigation = updates.mitigation;
        setTickets((prev) => prev.map((t) => (t.id === workItemId ? { ...t, ...applied } : t)));
        setSelectedTicket((prev) => (prev ? { ...prev, ...applied } : null));
        const fieldLabels: Record<keyof typeof updates, string> = {
          title: 'Title',
          description: 'Description',
          resolution: 'Resolution',
          mitigation: 'Mitigation',
        };
        const changedKey = (Object.keys(updates) as Array<keyof typeof updates>).find(
          (k) => updates[k] !== undefined
        );
        const field = (changedKey && fieldLabels[changedKey]) || 'Work item';
        toast.success(`${field} updated`);
      } catch (error) {
        console.error('Failed to update work item:', error);
        toast.error('Failed to update work item');
        throw error;
      }
    },
    [tickets, selectedOrganization]
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
            organization={selectedOrganization?.accountName}
            onRefresh={fetchTickets}
            showSource={gitHubConfigured}
          />
        </div>

        {/* Work item detail dialog for list and kanban clicks */}
        <WorkItemDetailDialog
          workItem={selectedTicket ? ticketToWorkItem(selectedTicket) : null}
          isOpen={!!selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onDeleted={(workItemId) => {
            setTickets((prev) => prev.filter((t) => t.id !== workItemId));
            fetchTickets();
          }}
          onStateChange={handleDialogStateChange}
          onAssigneeChange={handleDialogAssigneeChange}
          onPriorityChange={handleDialogPriorityChange}
          onEffortChange={handleDialogEffortChange}
          onTypeChange={handleDialogTypeChange}
          onTagsChange={handleDialogTagsChange}
          onUpdate={handleWorkItemUpdate}
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

/** Route entry for the tickets list; Suspense is required because the list reads search params. */
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
