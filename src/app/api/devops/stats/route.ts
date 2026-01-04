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

function calculateAvgResponseTime(_tickets: Ticket[]): string {
  // This would need actual first response data from DevOps
  // For now, return a placeholder
  return '< 2 hours';
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

    // Get the worst status between first response and resolution
    const firstResponseStatus = ticket.slaInfo.firstResponse.status;
    const resolutionStatus = ticket.slaInfo.resolution.status;

    let worstStatus: 'within_sla' | 'at_risk' | 'breached' = 'within_sla';
    if (firstResponseStatus === 'breached' || resolutionStatus === 'breached') {
      worstStatus = 'breached';
    } else if (firstResponseStatus === 'at_risk' || resolutionStatus === 'at_risk') {
      worstStatus = 'at_risk';
    }

    switch (worstStatus) {
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

    // Track by SLA level
    const level = ticket.slaInfo.level.toLowerCase() as 'gold' | 'silver' | 'bronze';
    if (byLevel[level]) {
      byLevel[level].total++;
      if (worstStatus !== 'breached') {
        byLevel[level].compliant++;
      }
    }
  }

  const totalActive = activeTickets.length;
  const complianceRate = totalActive > 0 ? Math.round((withinSLA / totalActive) * 100) : 100;

  return {
    withinSLA,
    atRisk,
    breached,
    complianceRate,
    byLevel,
  };
}
