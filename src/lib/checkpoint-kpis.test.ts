import { describe, it, expect } from 'vitest';
import { calculateKPIs, firstResponseTargetHours } from './checkpoint-kpis';
import type { Ticket, TicketPriority, TicketStatus } from '@/types';

// Monthly Checkpoint KPIs. SLA compliance used a fixed 24-hour target for
// every project; it now follows the project's SLA level (#130).

const CREATED = new Date('2026-10-01T09:00:00Z');
let nextId = 1;

/** A ticket first updated `hoursToResponse` hours after it was created. */
function ticket(
  hoursToResponse: number,
  overrides: { status?: TicketStatus; priority?: TicketPriority } = {}
): Ticket {
  return {
    id: nextId++,
    title: 'Ticket',
    status: overrides.status ?? 'Open',
    priority: overrides.priority,
    createdAt: CREATED,
    updatedAt: new Date(CREATED.getTime() + hoursToResponse * 60 * 60 * 1000),
  } as Ticket;
}

describe('firstResponseTargetHours', () => {
  it('follows the SLA level', () => {
    expect(firstResponseTargetHours({ priority: 'Normal' }, 'Gold')).toBe(4);
    expect(firstResponseTargetHours({ priority: 'Normal' }, 'Silver')).toBe(8);
    expect(firstResponseTargetHours({ priority: 'Normal' }, 'Bronze')).toBe(16);
  });

  it('treats a ticket with no priority as Normal', () => {
    expect(firstResponseTargetHours({}, 'Gold')).toBe(
      firstResponseTargetHours({ priority: 'Normal' }, 'Gold')
    );
  });
});

describe('calculateKPIs', () => {
  it('judges the same tickets differently under different SLA levels', () => {
    // Responses after 3, 6, 12 and 20 hours.
    const created = [ticket(3), ticket(6), ticket(12), ticket(20)];

    expect(calculateKPIs(created, [], created, 'Gold').slaCompliancePercent).toBe(25);
    expect(calculateKPIs(created, [], created, 'Silver').slaCompliancePercent).toBe(50);
    expect(calculateKPIs(created, [], created, 'Bronze').slaCompliancePercent).toBe(75);
  });

  it('no longer counts a response inside 24 hours as compliant by default', () => {
    const created = [ticket(20)];
    expect(calculateKPIs(created, [], created, 'Bronze').slaCompliancePercent).toBe(0);
  });

  it('counts a response exactly on the target as within it', () => {
    const created = [ticket(4)];
    expect(calculateKPIs(created, [], created, 'Gold').slaCompliancePercent).toBe(100);
  });

  it('reports the level and its target with the numbers', () => {
    const kpis = calculateKPIs([], [], [], 'Silver');
    expect(kpis.slaLevel).toBe('Silver');
    expect(kpis.slaResponseTargetHours).toBe(8);
  });

  it('leaves tickets that were never updated out of the response figures', () => {
    const created = [ticket(0), ticket(2)];
    const kpis = calculateKPIs(created, [], created, 'Gold');

    expect(kpis.totalTicketsCreated).toBe(2);
    expect(kpis.avgResponseTimeHours).toBe(2);
    expect(kpis.slaCompliancePercent).toBe(100);
  });

  it('reports zero, not NaN, when there is nothing to measure', () => {
    const kpis = calculateKPIs([], [], [], 'Bronze');
    expect(kpis).toMatchObject({
      totalTicketsCreated: 0,
      totalTicketsResolved: 0,
      totalTicketsPending: 0,
      totalTicketsOpen: 0,
      avgResponseTimeHours: 0,
      avgResolutionTimeHours: 0,
      slaCompliancePercent: 0,
    });
  });

  it('counts open and pending tickets across the whole project, and each resolved ticket once', () => {
    const resolved = ticket(10, { status: 'Resolved' });
    const all = [
      ticket(1, { status: 'New' }),
      ticket(1, { status: 'Open' }),
      ticket(1, { status: 'In Progress' }),
      ticket(1, { status: 'Pending' }),
      resolved,
    ];
    const kpis = calculateKPIs([], [resolved, resolved], all, 'Bronze');

    expect(kpis.totalTicketsOpen).toBe(3);
    expect(kpis.totalTicketsPending).toBe(1);
    expect(kpis.totalTicketsResolved).toBe(1);
    expect(kpis.avgResolutionTimeHours).toBe(10);
  });

  it('rounds the averages to one decimal place', () => {
    const created = [ticket(1), ticket(2), ticket(2)];
    expect(calculateKPIs(created, [], created, 'Gold').avgResponseTimeHours).toBe(1.7);
  });
});
