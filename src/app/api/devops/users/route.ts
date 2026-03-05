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

    // Fetch tickets, projects, and all users from entitlements API in parallel
    const [tickets, projects, allUsersWithLicenses] = await Promise.all([
      devopsService.getAllTickets(),
      devopsService.getProjects(),
      devopsService.getAllUsersWithEntitlements(),
    ]);

    // Start with all users from entitlements API
    const userMap = new Map<string, Customer>();

    // Add all users from entitlements API first
    for (const user of allUsersWithLicenses) {
      userMap.set(user.email.toLowerCase(), {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        timezone: '(GMT+00:00) Edinburgh',
        tags: [],
        avatarUrl: user.avatarUrl,
        license: user.license,
      });
    }

    // Update with ticket activity info
    for (const ticket of tickets) {
      const emailKey = ticket.requester.email.toLowerCase();
      const existing = userMap.get(emailKey);

      if (existing) {
        // Update with ticket activity
        if (!existing.lastUpdated || ticket.updatedAt > existing.lastUpdated) {
          existing.lastUpdated = ticket.updatedAt;
        }
        if (!existing.organizationId && ticket.organization?.id) {
          existing.organizationId = ticket.organization.id;
          existing.organization = ticket.organization;
        }
        // Use avatar from ticket if available
        if (!existing.avatarUrl && ticket.requester.avatarUrl) {
          existing.avatarUrl = ticket.requester.avatarUrl;
        }
      } else {
        // User not in entitlements - add from ticket
        userMap.set(emailKey, {
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
      }
    }

    // Also get team members from projects
    for (const project of projects) {
      try {
        const members = await devopsService.getTeamMembers(project.name);
        for (const member of members) {
          const emailKey = member.email.toLowerCase();
          if (!userMap.has(emailKey)) {
            userMap.set(emailKey, {
              id: member.id,
              displayName: member.displayName,
              email: member.email,
              timezone: '(GMT+00:00) Edinburgh',
              tags: [],
              avatarUrl: member.avatarUrl,
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
