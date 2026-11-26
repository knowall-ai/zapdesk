import { describe, it, expect } from 'vitest';
import { filterTicketsByView } from './ticket-views';
import type { Ticket, TicketStatus } from '@/types';

const ticket = (id: number, status: TicketStatus): Ticket =>
  ({ id, status, createdAt: new Date(), updatedAt: new Date() }) as unknown as Ticket;

const STATUSES: TicketStatus[] = ['New', 'Open', 'In Progress', 'Pending', 'Resolved', 'Closed'];
const tickets = STATUSES.map((s, i) => ticket(i + 1, s));
const statuses = (view: string) => filterTicketsByView(tickets, view).map((t) => t.status);

describe('All tickets view', () => {
  // Pending tickets only showed under "Recently updated" before: the view
  // left out everything past In Progress.
  it('shows every ticket that is not Closed, Pending and Resolved included', () => {
    expect(statuses('all-active')).toEqual(['New', 'Open', 'In Progress', 'Pending', 'Resolved']);
  });

  it('leaves the narrower unsolved view as it was', () => {
    expect(statuses('all-unsolved')).toEqual(['New', 'Open', 'In Progress']);
  });
});
