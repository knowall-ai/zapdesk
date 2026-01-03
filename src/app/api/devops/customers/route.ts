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

    // Extract unique customers from ticket requesters
    const customerMap = new Map<string, Customer>();

    for (const ticket of tickets) {
      if (!customerMap.has(ticket.requester.email)) {
        customerMap.set(ticket.requester.email, {
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
        const existing = customerMap.get(ticket.requester.email)!;
        if (ticket.updatedAt > existing.lastUpdated) {
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
          if (!customerMap.has(member.email)) {
            customerMap.set(member.email, {
              id: member.id,
              displayName: member.displayName,
              email: member.email,
              timezone: '(GMT+00:00) Edinburgh',
              tags: [],
              avatarUrl: member.avatarUrl,
              lastUpdated: new Date(),
            });
          }
        }
      } catch (error) {
        console.error(`Failed to get team members for ${project.name}:`, error);
      }
    }

    const customers = Array.from(customerMap.values()).sort(
      (a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime()
    );

    return NextResponse.json({ customers });
  } catch (error) {
    console.error('Error fetching customers:', error);
    return NextResponse.json({ error: 'Failed to fetch customers' }, { status: 500 });
  }
}
