import type { Ticket, TicketStatus } from '@/types';

/** Closed, and not merely Removed (which also shows as Closed). */
export function isClosedNotRemoved(ticket: Ticket): boolean {
  return ticket.status === 'Closed' && ticket.devOpsState !== 'Removed';
}

/** Narrow a ticket list to one of the sidebar views. Unknown views return everything. */
export function filterTicketsByView(
  tickets: Ticket[],
  view: string,
  userEmail?: string | null
): Ticket[] {
  const activeStatuses: TicketStatus[] = ['New', 'Open', 'In Progress'];
  const currentUserEmail = userEmail?.toLowerCase();

  switch (view) {
    case 'your-active':
    case 'your-unsolved':
      return tickets.filter(
        (t) =>
          activeStatuses.includes(t.status) && t.assignee?.email?.toLowerCase() === currentUserEmail
      );

    case 'unassigned':
      return tickets.filter((t) => !t.assignee && activeStatuses.includes(t.status));

    // "All open tickets": everything still open in any way -- Pending and Resolved
    // included -- so only Closed (and Removed, which maps to Closed) drop out.
    case 'all-active':
      return tickets.filter((t) => t.status !== 'Closed');

    case 'all-unsolved':
      return tickets.filter((t) => activeStatuses.includes(t.status));

    case 'recently-updated':
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return tickets.filter((t) => t.updatedAt >= weekAgo);

    case 'created-today':
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return tickets.filter((t) => t.createdAt >= today);

    case 'pending':
      return tickets.filter((t) => t.status === 'Pending');

    case 'recently-solved':
      const weekAgoSolved = new Date();
      weekAgoSolved.setDate(weekAgoSolved.getDate() - 7);
      return tickets.filter(
        (t) => (t.status === 'Resolved' || t.status === 'Closed') && t.updatedAt >= weekAgoSolved
      );

    // Every closed ticket, however long ago. Removed maps to Closed as well, so
    // those are left out by their DevOps state: they have a view of their own.
    case 'closed':
      return tickets.filter(isClosedNotRemoved);

    default:
      return tickets;
  }
}
