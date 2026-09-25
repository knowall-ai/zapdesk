import { type NextRequest, NextResponse } from 'next/server';
import { AzureDevOpsService } from '@/lib/devops';
import type { TeamMember, TeamStats, TicketStatus } from '@/types';
import {
  calculateAvgResolutionTime,
  calculateAvgResponseTime,
  calculateMemberStatus,
  calculateNeedsAttention,
  isInternalUser,
} from '@/lib/team-metrics';
import { requirePermission, isAuthed } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await requirePermission('team:view');
    if (!isAuthed(auth)) return auth;
    const { session } = auth;

    // Get the current user's email domain to filter internal users
    const userEmail = session.user?.email || '';
    const internalDomain = userEmail.includes('@') ? userEmail.split('@')[1].toLowerCase() : '';

    const devopsService = new AzureDevOpsService(session.accessToken!);

    // Get all users from the organization
    const orgUsers = await devopsService.getOrganizationUsers();
    const allMembers = new Map<string, TeamMember>();

    // Filter to only include users from the same domain as the current user
    for (const member of orgUsers) {
      if (!isInternalUser(member.email, internalDomain)) {
        continue;
      }
      if (!allMembers.has(member.id)) {
        allMembers.set(member.id, {
          ...member,
          status: 'On Track',
          ticketsAssigned: 0,
          ticketsResolved: 0,
          weeklyResolutions: 0,
          avgResponseTime: '-',
          avgResolutionTime: '-',
          pendingTickets: 0,
        });
      }
    }

    // Parse time period filter (days)
    const daysParam = request.nextUrl.searchParams.get('days');
    let cutoffDate: Date | null = null;
    if (daysParam !== null) {
      const days = Number(daysParam);
      if (Number.isFinite(days) && Number.isInteger(days) && days > 0) {
        if (days === 1) {
          // "Today" — use start of today
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          cutoffDate = today;
        } else {
          cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        }
      }
    }

    // Parse ticketsOnly filter
    const ticketsOnly = request.nextUrl.searchParams.get('ticketsOnly') !== 'false';

    // Get all tickets to calculate metrics
    const allTickets = await devopsService.getAllTickets(ticketsOnly);

    // Filter tickets by time period if specified
    const tickets = cutoffDate
      ? allTickets.filter((t) => t.createdAt >= cutoffDate || t.updatedAt >= cutoffDate)
      : allTickets;
    const now = new Date();
    const oneWeekAgo = new Date(now);
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const unsolvedStatuses: TicketStatus[] = ['New', 'Open', 'In Progress', 'Pending'];

    // Build a lookup map by email (lowercase) for matching assignees
    const membersByEmail = new Map<string, TeamMember>();
    for (const member of allMembers.values()) {
      if (member.email) {
        membersByEmail.set(member.email.toLowerCase(), member);
      }
    }

    // Track previous week resolutions for comparison
    const prevWeekResolutions = new Map<string, number>();

    // Calculate per-member metrics
    for (const ticket of tickets) {
      if (!ticket.assignee?.email) continue;

      const member = membersByEmail.get(ticket.assignee.email.toLowerCase());
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

        // Use resolvedAt when available for accurate resolution timing, fall back to updatedAt
        const resolutionDate = ticket.resolvedAt ?? ticket.updatedAt;

        // Count this week's resolutions
        if (resolutionDate >= oneWeekAgo) {
          member.weeklyResolutions++;
        }
        // Count previous week's resolutions (7-14 days ago)
        else if (resolutionDate >= twoWeeksAgo && resolutionDate < oneWeekAgo) {
          const memberEmail = member.email.toLowerCase();
          prevWeekResolutions.set(memberEmail, (prevWeekResolutions.get(memberEmail) || 0) + 1);
        }
      }
    }

    // Add trend indicator to weekly resolutions
    for (const member of allMembers.values()) {
      const prevWeek = prevWeekResolutions.get(member.email.toLowerCase()) || 0;
      const diff = member.weeklyResolutions - prevWeek;
      // Store as string with trend indicator
      if (diff > 0) {
        (member as TeamMember & { weeklyTrend?: string }).weeklyTrend = `+${diff}`;
      } else if (diff < 0) {
        (member as TeamMember & { weeklyTrend?: string }).weeklyTrend = `${diff}`;
      }
    }

    // Track resolution times for calculating averages (keyed by email)
    const memberResolutionTimes = new Map<string, number[]>();

    // Calculate resolution times from resolved tickets
    for (const ticket of tickets) {
      if (!ticket.assignee?.email) continue;
      if (ticket.status === 'Resolved' || ticket.status === 'Closed') {
        if (ticket.resolvedAt) {
          const resolutionMs = ticket.resolvedAt.getTime() - ticket.createdAt.getTime();
          const memberEmail = ticket.assignee.email.toLowerCase();
          if (!memberResolutionTimes.has(memberEmail)) {
            memberResolutionTimes.set(memberEmail, []);
          }
          memberResolutionTimes.get(memberEmail)!.push(resolutionMs);
        }
      }
    }

    // Calculate status for each member
    const teamMembers = Array.from(allMembers.values()).map((member) => {
      member.status = calculateMemberStatus(member);
      member.avgResponseTime = calculateAvgResponseTime(member);
      member.avgResolutionTime = calculateAvgResolutionTime(
        memberResolutionTimes.get(member.email.toLowerCase())
      );
      return member;
    });

    // Sort by tickets assigned (descending)
    teamMembers.sort((a, b) => b.ticketsAssigned - a.ticketsAssigned);

    // Calculate team stats from ALL tickets (unfiltered by time period)
    const stats: TeamStats = {
      totalMembers: teamMembers.length,
      openTickets: allTickets.filter((t) => t.status === 'Open' || t.status === 'New').length,
      inProgressTickets: allTickets.filter((t) => t.status === 'In Progress').length,
      needsAttention: calculateNeedsAttention(allTickets),
    };

    return NextResponse.json({ members: teamMembers, stats });
  } catch (error) {
    console.error('Error fetching team data:', error);
    return NextResponse.json({ error: 'Failed to fetch team data' }, { status: 500 });
  }
}
