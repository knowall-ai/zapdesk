'use client';

import type { Ticket } from '@/types';
import WorkItemBoard, { TICKET_COLUMNS } from './WorkItemBoard';

interface TicketListProps {
  tickets: Ticket[];
  title: string;
  hideFilters?: boolean;
}

/**
 * TicketList - Displays tickets (work items tagged with "ticket")
 *
 * This is a wrapper around WorkItemList that converts Ticket[] to WorkItem[]
 * and uses the ticket-specific column configuration.
 */
export default function TicketList({ tickets, title, hideFilters = false }: TicketListProps) {
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
      columns={TICKET_COLUMNS}
      groupBy="assignee"
    />
  );
}
