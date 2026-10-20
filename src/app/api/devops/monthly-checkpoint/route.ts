import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService, workItemToTicket } from '@/lib/devops';
import { requestDevOpsOrg } from '@/lib/devops-org';
import type {
  Ticket,
  TicketStatus,
  MonthlyCheckpointStats,
  TicketTrendPoint,
  Organization,
  CheckpointCustomer,
} from '@/types';

/** The query parameters this route reads; anything else is refused. */
const ALLOWED_PARAMS = new Set(['project', 'startDate', 'endDate', 'customer']);

/**
 * Monthly checkpoint statistics for one project and period.
 *
 * Query: `project` is required. `startDate` and `endDate` default to the last
 * 30 days. `customer` (a key from `customers`) narrows every figure to that
 * customer's tickets (#7385).
 *
 * Returns the KPIs, daily trend points, the tickets created or resolved in the
 * period, and `customers`: everyone who has raised a ticket in the project,
 * so the filter can offer them.
 *
 * 400 for an unknown query parameter, without a project, or for a customer the
 * project has never had; 401 without a session; 500 when Azure DevOps fails.
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);

    // Refuse parameters this route does not read. A misspelt `customer` would
    // otherwise be ignored and the whole project's report returned as if it
    // were one customer's.
    const unknown = [...new Set(searchParams.keys())].filter((key) => !ALLOWED_PARAMS.has(key));
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: `Unknown query parameter: ${unknown.join(', ')}` },
        { status: 400 }
      );
    }

    const projectName = searchParams.get('project');
    const startDateParam = searchParams.get('startDate');
    const endDateParam = searchParams.get('endDate');
    // Optional: one customer's tickets only (#7385). Matched on customerKey.
    const customerParam = (searchParams.get('customer') || '').trim().toLowerCase();

    if (!projectName) {
      return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
    }

    // Default to last 30 days if no dates provided
    const endDateRaw = endDateParam ? new Date(endDateParam) : new Date();
    const startDateRaw = startDateParam
      ? new Date(startDateParam)
      : new Date(endDateRaw.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Set time to start/end of day (create new Date objects to avoid mutation)
    const startDate = new Date(startDateRaw);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(endDateRaw);
    endDate.setHours(23, 59, 59, 999);

    const devopsService = new AzureDevOpsService(session.accessToken, requestDevOpsOrg(request));

    // Fetch all tickets for the project
    const workItems = await devopsService.getTickets(projectName);

    const organization: Organization = {
      id: projectName,
      name: projectName,
      devOpsProject: projectName,
      devOpsOrg: devopsService.organizationName,
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const projectTickets = workItems.map((wi) => workItemToTicket(wi, organization));

    // The customers on offer come from the whole project, so picking one does
    // not empty the list of the others.
    const customerMap = new Map<string, CheckpointCustomer>();
    for (const t of projectTickets) {
      const key = customerKey(t);
      if (!key) continue;
      const existing = customerMap.get(key);
      if (existing) existing.ticketCount += 1;
      else
        customerMap.set(key, {
          key,
          displayName: t.requester?.displayName || key,
          ticketCount: 1,
        });
    }
    const customers = [...customerMap.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );

    // A customer the project has never had is a bad request, not a report of
    // zeroes that reads as "this customer raised nothing".
    if (customerParam && !customerMap.has(customerParam)) {
      return NextResponse.json({ error: 'Unknown customer for this project' }, { status: 400 });
    }

    const allTickets = customerParam
      ? projectTickets.filter((t) => customerKey(t) === customerParam)
      : projectTickets;

    // Filter tickets created within the date range
    const ticketsInRange = allTickets.filter((t) => {
      const createdAt = new Date(t.createdAt);
      return createdAt >= startDate && createdAt <= endDate;
    });

    // Also include tickets that were resolved within the date range
    const ticketsResolvedInRange = allTickets.filter((t) => {
      const updatedAt = new Date(t.updatedAt);
      const isResolved = t.status === 'Resolved' || t.status === 'Closed';
      return isResolved && updatedAt >= startDate && updatedAt <= endDate;
    });

    // Combine and dedupe for the full view
    const relevantTicketIds = new Set([
      ...ticketsInRange.map((t) => t.id),
      ...ticketsResolvedInRange.map((t) => t.id),
    ]);
    const relevantTickets = allTickets.filter((t) => relevantTicketIds.has(t.id));

    // Calculate KPIs
    const kpis = calculateKPIs(ticketsInRange, ticketsResolvedInRange, allTickets);

    // Calculate trends (daily data points)
    const trends = calculateTrends(allTickets, startDate, endDate);

    const stats: MonthlyCheckpointStats = {
      period: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
      kpis,
      trends,
      tickets: relevantTickets.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
      customers,
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching monthly checkpoint data:', error);
    return NextResponse.json({ error: 'Failed to fetch monthly checkpoint data' }, { status: 500 });
  }
}

/** Who raised a ticket, as the customer filter knows them. */
function customerKey(ticket: Ticket): string {
  // Email first; then the identity id, so two people who share a display name
  // are never merged; the name only as a last resort.
  const requester = ticket.requester;
  const key =
    requester?.email?.trim() || requester?.id?.trim() || requester?.displayName?.trim() || '';
  return key.toLowerCase();
}

/**
 * Headline figures for the period: tickets created, resolved, pending and
 * open, average response and resolution times in hours, and the share of
 * tickets answered within the response SLA.
 */
function calculateKPIs(
  ticketsCreated: Ticket[],
  ticketsResolved: Ticket[],
  allTickets: Ticket[]
): MonthlyCheckpointStats['kpis'] {
  const unsolvedStatuses: TicketStatus[] = ['New', 'Open', 'In Progress'];
  const pendingStatuses: TicketStatus[] = ['Pending'];

  // Unique resolved tickets count
  const uniqueResolvedIds = new Set(ticketsResolved.map((t) => t.id));

  // Calculate average response time (time from creation to first update)
  // This is an approximation - ideally we'd track first response separately
  const responseTimesHours = ticketsCreated
    .filter((t) => t.updatedAt.getTime() !== t.createdAt.getTime())
    .map((t) => (t.updatedAt.getTime() - t.createdAt.getTime()) / (1000 * 60 * 60));

  const avgResponseTimeHours =
    responseTimesHours.length > 0
      ? responseTimesHours.reduce((a, b) => a + b, 0) / responseTimesHours.length
      : 0;

  // Calculate average resolution time
  const resolutionTimesHours = ticketsResolved.map(
    (t) => (t.updatedAt.getTime() - t.createdAt.getTime()) / (1000 * 60 * 60)
  );

  const avgResolutionTimeHours =
    resolutionTimesHours.length > 0
      ? resolutionTimesHours.reduce((a, b) => a + b, 0) / resolutionTimesHours.length
      : 0;

  // Calculate SLA compliance (assuming 24-hour response SLA)
  const SLA_RESPONSE_HOURS = 24;
  const ticketsWithinSLA = responseTimesHours.filter((h) => h <= SLA_RESPONSE_HOURS).length;
  const slaCompliancePercent =
    responseTimesHours.length > 0 ? (ticketsWithinSLA / responseTimesHours.length) * 100 : 0;

  return {
    totalTicketsCreated: ticketsCreated.length,
    totalTicketsResolved: uniqueResolvedIds.size,
    totalTicketsPending: allTickets.filter((t) => pendingStatuses.includes(t.status)).length,
    totalTicketsOpen: allTickets.filter((t) => unsolvedStatuses.includes(t.status)).length,
    avgResponseTimeHours: Math.round(avgResponseTimeHours * 10) / 10,
    avgResolutionTimeHours: Math.round(avgResolutionTimeHours * 10) / 10,
    slaCompliancePercent: Math.round(slaCompliancePercent),
  };
}

/** Tickets created and resolved on each day of the period, for the trend charts. */
function calculateTrends(tickets: Ticket[], startDate: Date, endDate: Date): TicketTrendPoint[] {
  const trends: TicketTrendPoint[] = [];
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const dayStart = new Date(currentDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(currentDate);
    dayEnd.setHours(23, 59, 59, 999);

    // Tickets created on this day
    const createdOnDay = tickets.filter((t) => {
      const created = new Date(t.createdAt);
      return created >= dayStart && created <= dayEnd;
    });

    // Tickets resolved on this day
    const resolvedOnDay = tickets.filter((t) => {
      const updated = new Date(t.updatedAt);
      const isResolved = t.status === 'Resolved' || t.status === 'Closed';
      return isResolved && updated >= dayStart && updated <= dayEnd;
    });

    // Calculate daily averages
    const responseTimesHours = createdOnDay
      .filter((t) => t.updatedAt.getTime() !== t.createdAt.getTime())
      .map((t) => (t.updatedAt.getTime() - t.createdAt.getTime()) / (1000 * 60 * 60));

    const resolutionTimesHours = resolvedOnDay.map(
      (t) => (t.updatedAt.getTime() - t.createdAt.getTime()) / (1000 * 60 * 60)
    );

    trends.push({
      date: currentDate.toISOString().split('T')[0],
      ticketsCreated: createdOnDay.length,
      ticketsResolved: resolvedOnDay.length,
      avgResponseTimeHours:
        responseTimesHours.length > 0
          ? Math.round(
              (responseTimesHours.reduce((a, b) => a + b, 0) / responseTimesHours.length) * 10
            ) / 10
          : 0,
      avgResolutionTimeHours:
        resolutionTimesHours.length > 0
          ? Math.round(
              (resolutionTimesHours.reduce((a, b) => a + b, 0) / resolutionTimesHours.length) * 10
            ) / 10
          : 0,
    });

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return trends;
}
