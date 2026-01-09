import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';
import type { TicketStatus } from '@/types';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const devopsService = new AzureDevOpsService(session.accessToken);
    const tickets = await devopsService.getAllTickets();
    const currentUserEmail = session.user?.email?.toLowerCase();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const activeStatuses: TicketStatus[] = ['New', 'Open', 'In Progress'];

    const counts = {
      yourActive: tickets.filter(
        (t) =>
          activeStatuses.includes(t.status) && t.assignee?.email?.toLowerCase() === currentUserEmail
      ).length,
      ratedLast7Days: 0, // Would need rating data from DevOps
      unassigned: tickets.filter((t) => activeStatuses.includes(t.status) && !t.assignee).length,
      allActive: tickets.filter((t) => activeStatuses.includes(t.status)).length,
      recentlyUpdated: tickets.filter((t) => t.updatedAt >= sevenDaysAgo).length,
      createdToday: tickets.filter((t) => t.createdAt >= today).length,
      pending: tickets.filter((t) => t.status === 'Pending').length,
      recentlySolved: tickets.filter((t) => {
        const solved = t.status === 'Resolved' || t.status === 'Closed';
        const recent = t.updatedAt >= sevenDaysAgo;
        return solved && recent;
      }).length,
    };

    return NextResponse.json(counts);
  } catch (error) {
    console.error('Error fetching ticket counts:', error);
    return NextResponse.json({ error: 'Failed to fetch ticket counts' }, { status: 500 });
  }
}
