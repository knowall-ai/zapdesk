import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';
import type { Ticket, TicketStatus } from '@/types';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const devopsService = new AzureDevOpsService(session.accessToken);
    const tickets = await devopsService.getAllTickets();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const unsolvedStatuses: TicketStatus[] = ['New', 'Open', 'In Progress', 'Pending'];
    const openTickets = tickets.filter((t) => unsolvedStatuses.includes(t.status));

    // Calculate SLA compliance stats
    const slaStats = calculateSLAStats(tickets);

    const stats = {
      totalTickets: tickets.length,
      openTickets: openTickets.length,
      pendingTickets: tickets.filter((t) => t.status === 'Pending').length,
      resolvedToday: tickets.filter((t) => {
        const resolved = t.status === 'Resolved' || t.status === 'Closed';
        const updatedToday = t.updatedAt >= today;
        return resolved && updatedToday;
      }).length,
      avgResponseTime: calculateAvgResponseTime(tickets),
      customerSatisfaction: 0, // Would need CSAT integration
      // SLA Stats
      sla: slaStats,
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}

function calculateAvgResponseTime(tickets: Ticket[]): string {
  // Calculate average first response time from tickets with firstResponseAt populated
  const ticketsWithResponse = tickets.filter((t) => t.firstResponseAt && t.createdAt);

  if (ticketsWithResponse.length === 0) {
    return 'N/A';
  }

  const totalMinutes = ticketsWithResponse.reduce((sum, ticket) => {
    const responseTime =
      (ticket.firstResponseAt!.getTime() - ticket.createdAt.getTime()) / (1000 * 60);
    return sum + responseTime;
  }, 0);

  const avgMinutes = totalMinutes / ticketsWithResponse.length;

  // Format the average response time
  if (avgMinutes < 60) {
    return `${Math.round(avgMinutes)} min`;
  } else if (avgMinutes < 1440) {
    const hours = Math.round(avgMinutes / 60);
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  } else {
    const days = Math.round(avgMinutes / 1440);
    return `${days} day${days !== 1 ? 's' : ''}`;
  }
}

interface SLAStats {
  withinSLA: number;
  atRisk: number;
  breached: number;
  complianceRate: number;
  byLevel: {
    gold: { total: number; compliant: number };
    silver: { total: number; compliant: number };
    bronze: { total: number; compliant: number };
  };
}

function calculateSLAStats(tickets: Ticket[]): SLAStats {
  const unsolvedStatuses: TicketStatus[] = ['New', 'Open', 'In Progress', 'Pending'];
  const activeTickets = tickets.filter((t) => unsolvedStatuses.includes(t.status));

  let withinSLA = 0;
  let atRisk = 0;
  let breached = 0;

  const byLevel = {
    gold: { total: 0, compliant: 0 },
    silver: { total: 0, compliant: 0 },
    bronze: { total: 0, compliant: 0 },
  };

  for (const ticket of activeTickets) {
    if (!ticket.slaInfo) continue;

    // Get the most critical status between first response and resolution
    const firstResponseStatus = ticket.slaInfo.firstResponse.status;
    const resolutionStatus = ticket.slaInfo.resolution.status;

    let criticalStatus: 'within_sla' | 'at_risk' | 'breached' = 'within_sla';
    if (firstResponseStatus === 'breached' || resolutionStatus === 'breached') {
      criticalStatus = 'breached';
    } else if (firstResponseStatus === 'at_risk' || resolutionStatus === 'at_risk') {
      criticalStatus = 'at_risk';
    }

    switch (criticalStatus) {
      case 'within_sla':
        withinSLA++;
        break;
      case 'at_risk':
        atRisk++;
        break;
      case 'breached':
        breached++;
        break;
    }

    // Track by SLA level - at_risk counts as compliant (not yet breached)
    const level = ticket.slaInfo.level.toLowerCase() as 'gold' | 'silver' | 'bronze';
    if (byLevel[level]) {
      byLevel[level].total++;
      if (criticalStatus !== 'breached') {
        byLevel[level].compliant++;
      }
    }
  }

  const totalActive = activeTickets.length;
  // Compliance rate: tickets not breached (within_sla + at_risk) / total
  const compliantCount = withinSLA + atRisk;
  const complianceRate = totalActive > 0 ? Math.round((compliantCount / totalActive) * 100) : 100;

  return {
    withinSLA,
    atRisk,
    breached,
    complianceRate,
    byLevel,
  };
}
