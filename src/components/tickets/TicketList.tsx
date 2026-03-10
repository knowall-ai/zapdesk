'use client';

import type { Ticket, WorkItem, WorkItemType } from '@/types';
import WorkItemBoard, { TICKET_COLUMNS } from './WorkItemBoard';

interface TicketListProps {
  tickets: Ticket[];
  title: string;
  hideFilters?: boolean;
  hideTicketsOnlyToggle?: boolean;
  onWorkItemClick?: (item: WorkItem) => void;
  onZapClick?: (item: WorkItem) => void;
  onStatusChange?: (itemId: number, newState: string) => Promise<void>;
  availableTypes?: WorkItemType[];
  defaultViewMode?: 'list' | 'kanban';
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
  availableTypes,
  defaultViewMode,
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
  }));

  return (
    <WorkItemBoard
      items={workItems}
      title={title}
      hideFilters={hideFilters}
      hideTicketsOnlyToggle={hideTicketsOnlyToggle}
      columns={TICKET_COLUMNS}
      groupBy="assignee"
      availableGroupBy={['none', 'assignee']}
      availableTypes={availableTypes}
      onStatusChange={onStatusChange}
      onWorkItemClick={onWorkItemClick}
      onZapClick={onZapClick}
      defaultViewMode={defaultViewMode}
    />
  );
}
