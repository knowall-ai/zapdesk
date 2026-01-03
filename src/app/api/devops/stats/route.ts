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

    const stats = {
      totalTickets: tickets.length,
      openTickets: tickets.filter((t) => unsolvedStatuses.includes(t.status)).length,
      pendingTickets: tickets.filter((t) => t.status === 'Pending').length,
      resolvedToday: tickets.filter((t) => {
        const resolved = t.status === 'Resolved' || t.status === 'Closed';
        const updatedToday = t.updatedAt >= today;
        return resolved && updatedToday;
      }).length,
      avgResponseTime: calculateAvgResponseTime(tickets),
      customerSatisfaction: 0, // Would need CSAT integration
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}

function calculateAvgResponseTime(tickets: Ticket[]): string {
  // This would need actual first response data from DevOps
  // For now, return a placeholder
  return '< 2 hours';
}
