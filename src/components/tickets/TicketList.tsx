'use client';

import type { Ticket, WorkItem, WorkItemType } from '@/types';
import WorkItemBoard, { TICKET_COLUMNS, TICKET_COLUMNS_WITH_SOURCE } from './WorkItemBoard';

interface TicketListProps {
  tickets: Ticket[];
  title: string;
  hideFilters?: boolean;
  hideTicketsOnlyToggle?: boolean;
  onWorkItemClick?: (item: WorkItem) => void;
  onZapClick?: (item: WorkItem) => void;
  onStatusChange?: (itemId: number, newState: string) => Promise<void>;
  onRefresh?: () => void;
  availableTypes?: WorkItemType[];
  defaultViewMode?: 'list' | 'kanban';
  organization?: string;
  showSource?: boolean; // Add the Source column (Azure DevOps / GitHub)
}

/**
 * TicketList - Displays tickets (work items tagged with "ticket")
 *
 * This is a wrapper around WorkItemBoard that converts Ticket[] to WorkItem[]
 * and uses the ticket-specific column configuration.
 */
export default function TicketList({
  tickets,
  title,
  hideFilters = false,
  hideTicketsOnlyToggle = false,
  onWorkItemClick,
  onZapClick,
  onStatusChange,
  onRefresh,
  availableTypes,
  defaultViewMode,
  organization,
  showSource = false,
}: TicketListProps) {
  // Convert Ticket[] to WorkItem[] format
  const workItems = tickets.map((ticket) => ({
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
    source: ticket.source,
    sourceUrl: ticket.sourceUrl,
    sourceRef: ticket.sourceRef,
  }));

  return (
    <WorkItemBoard
      items={workItems}
      title={title}
      hideFilters={hideFilters}
      hideTicketsOnlyToggle={hideTicketsOnlyToggle}
      columns={showSource ? TICKET_COLUMNS_WITH_SOURCE : TICKET_COLUMNS}
      groupBy="assignee"
      availableGroupBy={['none', 'assignee']}
      availableTypes={availableTypes}
      onStatusChange={onStatusChange}
      onWorkItemClick={onWorkItemClick}
      onZapClick={onZapClick}
      onRefresh={onRefresh}
      defaultViewMode={defaultViewMode}
      organization={organization}
    />
  );
}
