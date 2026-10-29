import { NextRequest, NextResponse } from 'next/server';
import { getServerSessionWithToken } from '@/lib/server-session';
import { AzureDevOpsService } from '@/lib/devops';
import type { TicketStatus } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSessionWithToken();

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get organization from header (client sends from localStorage selection)
    const organization = request.headers.get('x-devops-org');

    if (!organization) {
      return NextResponse.json({ error: 'No organization specified' }, { status: 400 });
    }

    const devopsService = new AzureDevOpsService(session.accessToken, organization);
    const { tickets, failedProjects } = await devopsService.getAllTickets();
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

    // A project that failed contributes no tickets, so every count below is
    // short by an unknown amount. Said plainly rather than left to look like
    // a quiet week (#509).
    return NextResponse.json({
      ...counts,
      ...(failedProjects.length > 0 ? { failedProjects } : {}),
    });
  } catch (error) {
    console.error('Error fetching ticket counts:', error);
    return NextResponse.json({ error: 'Failed to fetch ticket counts' }, { status: 500 });
  }
}
