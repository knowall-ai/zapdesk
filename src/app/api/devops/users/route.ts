import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';
import type { Customer } from '@/types';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const devopsService = new AzureDevOpsService(session.accessToken);
    const tickets = await devopsService.getAllTickets();

    // Extract unique users from ticket requesters
    const userMap = new Map<string, Customer>();

    for (const ticket of tickets) {
      if (!userMap.has(ticket.requester.email)) {
        userMap.set(ticket.requester.email, {
          id: ticket.requester.id,
          displayName: ticket.requester.displayName,
          email: ticket.requester.email,
          organizationId: ticket.organization?.id,
          organization: ticket.organization,
          timezone: '(GMT+00:00) Edinburgh',
          tags: [],
          avatarUrl: ticket.requester.avatarUrl,
          lastUpdated: ticket.updatedAt,
        });
      } else {
        // Update last updated if this ticket is more recent
        const existing = userMap.get(ticket.requester.email)!;
        if (!existing.lastUpdated || ticket.updatedAt > existing.lastUpdated) {
          existing.lastUpdated = ticket.updatedAt;
        }
      }
    }

    // Also get team members from projects
    const projects = await devopsService.getProjects();
    for (const project of projects) {
      try {
        const members = await devopsService.getTeamMembers(project.name);
        for (const member of members) {
          if (!userMap.has(member.email)) {
            userMap.set(member.email, {
              id: member.id,
              displayName: member.displayName,
              email: member.email,
              timezone: '(GMT+00:00) Edinburgh',
              tags: [],
              avatarUrl: member.avatarUrl,
              // No lastUpdated - user has no ticket activity
            });
          }
        }
      } catch (error) {
        console.error(`Failed to get team members for ${project.name}:`, error);
      }
    }

    const users = Array.from(userMap.values()).sort((a, b) => {
      // Users with ticket activity first, sorted by most recent
      if (a.lastUpdated && b.lastUpdated) {
        return b.lastUpdated.getTime() - a.lastUpdated.getTime();
      }
      if (a.lastUpdated) return -1;
      if (b.lastUpdated) return 1;
      // Both without activity - sort by name
      return a.displayName.localeCompare(b.displayName);
    });

    return NextResponse.json({ users });
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}
