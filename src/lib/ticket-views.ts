import type { Ticket, TicketStatus } from '@/types';

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

    case 'all-active':
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

    default:
      return tickets;
  }
}
