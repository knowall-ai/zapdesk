import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';
import type { TeamMember, TeamMemberStatus, TeamStats, TicketStatus, Ticket } from '@/types';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const devopsService = new AzureDevOpsService(session.accessToken);

    // Get all projects and team members
    const projects = await devopsService.getProjects();
    const allMembers = new Map<string, TeamMember>();

    // Get team members from all projects
    for (const project of projects) {
      try {
        const members = await devopsService.getTeamMembers(project.name);
        for (const member of members) {
          if (!allMembers.has(member.id)) {
            allMembers.set(member.id, {
              ...member,
              status: 'On Track',
              ticketsAssigned: 0,
              ticketsResolved: 0,
              weeklyResolutions: 0,
              avgResponseTime: '-',
              pendingTickets: 0,
            });
          }
        }
      } catch (error) {
        console.error(`Failed to fetch team members from ${project.name}:`, error);
      }
    }

    // Get all tickets to calculate metrics
    const tickets = await devopsService.getAllTickets();
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const unsolvedStatuses: TicketStatus[] = ['New', 'Open', 'In Progress', 'Pending'];

    // Calculate per-member metrics
    for (const ticket of tickets) {
      if (!ticket.assignee) continue;

      const member = allMembers.get(ticket.assignee.id);
      if (!member) continue;

      // Count assigned tickets (unsolved)
      if (unsolvedStatuses.includes(ticket.status)) {
        member.ticketsAssigned++;
        if (ticket.status === 'Pending') {
          member.pendingTickets++;
        }
      }

      // Count resolved tickets
      if (ticket.status === 'Resolved' || ticket.status === 'Closed') {
        member.ticketsResolved++;

        // Count weekly resolutions
        if (ticket.updatedAt >= oneWeekAgo) {
          member.weeklyResolutions++;
        }
      }
    }

    // Calculate status for each member
    const teamMembers = Array.from(allMembers.values()).map((member) => {
      member.status = calculateMemberStatus(member);
      member.avgResponseTime = calculateAvgResponseTime(member);
      return member;
    });

    // Sort by tickets assigned (descending)
    teamMembers.sort((a, b) => b.ticketsAssigned - a.ticketsAssigned);

    // Calculate team stats
    const stats: TeamStats = {
      totalMembers: teamMembers.length,
      openTickets: tickets.filter((t) => t.status === 'Open' || t.status === 'New').length,
      inProgressTickets: tickets.filter((t) => t.status === 'In Progress').length,
      needsAttention: calculateNeedsAttention(tickets),
    };

    return NextResponse.json({ members: teamMembers, stats });
  } catch (error) {
    console.error('Error fetching team data:', error);
    return NextResponse.json({ error: 'Failed to fetch team data' }, { status: 500 });
  }
}

function calculateMemberStatus(member: TeamMember): TeamMemberStatus {
  // Heuristics for member status
  if (member.pendingTickets > 5 || member.ticketsAssigned > 15) {
    return 'Needs Attention';
  }
  if (member.pendingTickets > 2 || member.ticketsAssigned > 10) {
    return 'Behind';
  }
  return 'On Track';
}

function calculateAvgResponseTime(member: TeamMember): string {
  // In a real implementation, this would calculate from actual response data
  // For now, estimate based on workload
  if (member.ticketsAssigned > 10) {
    return '> 4 hours';
  }
  if (member.ticketsAssigned > 5) {
    return '2-4 hours';
  }
  return '< 2 hours';
}

function calculateNeedsAttention(tickets: Ticket[]): number {
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  return tickets.filter((t) => {
    // Unassigned tickets
    if (!t.assignee && (t.status === 'New' || t.status === 'Open')) {
      return true;
    }
    // Stale tickets (not updated in 3 days and still open)
    if (
      t.updatedAt < threeDaysAgo &&
      (t.status === 'Open' || t.status === 'In Progress' || t.status === 'Pending')
    ) {
      return true;
    }
    return false;
  }).length;
}
