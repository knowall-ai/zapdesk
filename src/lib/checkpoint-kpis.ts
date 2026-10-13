/**
 * The headline numbers on the Monthly Checkpoint page.
 *
 * Kept apart from the route so the arithmetic can be tested without a session
 * or Azure DevOps.
 */

import { getSLAPolicy, getSLATargets } from './sla';
import type { MonthlyCheckpointStats, SLALevel, Ticket, TicketStatus } from '@/types';

const MS_PER_HOUR = 1000 * 60 * 60;

/**
 * Hours a ticket may wait for its first response under `slaLevel`.
 *
 * This used to be a fixed 24 hours for every project (#130). Projects are on
 * different agreements, so the target now comes from the project's own SLA
 * level, and from the ticket's priority within it. A ticket with no priority
 * is treated as Normal.
 */
export function firstResponseTargetHours(ticket: Pick<Ticket, 'priority'>, slaLevel: SLALevel) {
  const targets = getSLATargets(getSLAPolicy(slaLevel), ticket.priority ?? 'Normal');
  return targets.firstResponseMinutes / 60;
}

/**
 * @param ticketsCreated  Tickets created in the period.
 * @param ticketsResolved Tickets resolved in the period.
 * @param allTickets      Every ticket in the project, for the open and pending totals.
 * @param slaLevel        The project's SLA level.
 */
export function calculateKPIs(
  ticketsCreated: readonly Ticket[],
  ticketsResolved: readonly Ticket[],
  allTickets: readonly Ticket[],
  slaLevel: SLALevel
): MonthlyCheckpointStats['kpis'] {
  const unsolvedStatuses: TicketStatus[] = ['New', 'Open', 'In Progress'];
  const pendingStatuses: TicketStatus[] = ['Pending'];

  // Unique resolved tickets count
  const uniqueResolvedIds = new Set(ticketsResolved.map((t) => t.id));

  // Calculate average response time (time from creation to first update)
  // This is an approximation - ideally we'd track first response separately
  const responded = ticketsCreated
    .filter((t) => t.updatedAt.getTime() !== t.createdAt.getTime())
    .map((t) => ({
      ticket: t,
      hours: (t.updatedAt.getTime() - t.createdAt.getTime()) / MS_PER_HOUR,
    }));

  const avgResponseTimeHours =
    responded.length > 0 ? responded.reduce((sum, r) => sum + r.hours, 0) / responded.length : 0;

  // Calculate average resolution time
  const resolutionTimesHours = ticketsResolved.map(
    (t) => (t.updatedAt.getTime() - t.createdAt.getTime()) / MS_PER_HOUR
  );

  const avgResolutionTimeHours =
    resolutionTimesHours.length > 0
      ? resolutionTimesHours.reduce((a, b) => a + b, 0) / resolutionTimesHours.length
      : 0;

  // SLA compliance: each ticket against the first-response target for the
  // project's SLA level and the ticket's own priority.
  const withinSLA = responded.filter(
    (r) => r.hours <= firstResponseTargetHours(r.ticket, slaLevel)
  ).length;
  const slaCompliancePercent = responded.length > 0 ? (withinSLA / responded.length) * 100 : 0;

  return {
    totalTicketsCreated: ticketsCreated.length,
    totalTicketsResolved: uniqueResolvedIds.size,
    totalTicketsPending: allTickets.filter((t) => pendingStatuses.includes(t.status)).length,
    totalTicketsOpen: allTickets.filter((t) => unsolvedStatuses.includes(t.status)).length,
    avgResponseTimeHours: Math.round(avgResponseTimeHours * 10) / 10,
    avgResolutionTimeHours: Math.round(avgResolutionTimeHours * 10) / 10,
    slaCompliancePercent: Math.round(slaCompliancePercent),
    slaLevel,
    slaResponseTargetHours: firstResponseTargetHours({ priority: 'Normal' }, slaLevel),
  };
}
