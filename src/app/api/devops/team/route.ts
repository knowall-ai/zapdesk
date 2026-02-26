import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';
import type { TeamMember, TeamMemberStatus, TeamStats, TicketStatus, Ticket } from '@/types';

// Cache for actual response time data (avoids re-fetching comments on every page load)
let responseTimeCache: {
  data: Map<string, number[]>; // member email -> response times in ms
  timestamp: number;
} | null = null;
const RESPONSE_TIME_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get the current user's email domain to filter internal users
    const userEmail = session.user?.email || '';
    const internalDomain = userEmail.includes('@') ? userEmail.split('@')[1].toLowerCase() : '';

    const devopsService = new AzureDevOpsService(session.accessToken);

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

    // Get all tickets to calculate metrics
    const tickets = await devopsService.getAllTickets();
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

    // Use cached response times if available; otherwise trigger background fetch
    // This avoids blocking the page load with hundreds of comment API calls
    let memberResponseTimes: Map<string, number[]>;
    if (
      responseTimeCache &&
      Date.now() - responseTimeCache.timestamp < RESPONSE_TIME_CACHE_TTL_MS
    ) {
      memberResponseTimes = responseTimeCache.data;
    } else {
      // Return fallback estimates now, populate cache in background for next load
      memberResponseTimes = new Map();
      fetchResponseTimes(devopsService, tickets, internalDomain).then((data) => {
        responseTimeCache = { data, timestamp: Date.now() };
      });
    }

    // Calculate status for each member
    const teamMembers = Array.from(allMembers.values()).map((member) => {
      member.status = calculateMemberStatus(member);
      member.avgResponseTime = calculateAvgResponseTime(
        memberResponseTimes.get(member.email.toLowerCase()),
        member
      );
      member.avgResolutionTime = calculateAvgResolutionTime(
        memberResolutionTimes.get(member.email.toLowerCase())
      );
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

// Team status thresholds — configurable via environment variables
function getIntEnv(envName: string, defaultValue: number): number {
  const raw = process.env[envName];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return defaultValue;
  }
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

const THRESHOLD_NEEDS_ATTENTION_PENDING = getIntEnv('TEAM_THRESHOLD_NEEDS_ATTENTION_PENDING', 5);
const THRESHOLD_NEEDS_ATTENTION_ASSIGNED = getIntEnv('TEAM_THRESHOLD_NEEDS_ATTENTION_ASSIGNED', 15);
const THRESHOLD_BEHIND_PENDING = getIntEnv('TEAM_THRESHOLD_BEHIND_PENDING', 2);
const THRESHOLD_BEHIND_ASSIGNED = getIntEnv('TEAM_THRESHOLD_BEHIND_ASSIGNED', 10);

function calculateMemberStatus(member: TeamMember): TeamMemberStatus {
  if (
    member.pendingTickets > THRESHOLD_NEEDS_ATTENTION_PENDING ||
    member.ticketsAssigned > THRESHOLD_NEEDS_ATTENTION_ASSIGNED
  ) {
    return 'Needs Attention';
  }
  if (
    member.pendingTickets > THRESHOLD_BEHIND_PENDING ||
    member.ticketsAssigned > THRESHOLD_BEHIND_ASSIGNED
  ) {
    return 'Behind';
  }
  return 'On Track';
}

function formatDuration(avgMs: number): string {
  const avgHours = avgMs / (1000 * 60 * 60);
  const avgDays = avgHours / 24;

  if (avgDays >= 7) {
    const weeks = Math.round(avgDays / 7);
    return `${weeks}w`;
  }
  if (avgDays >= 1) {
    const days = Math.round(avgDays);
    return `${days}d`;
  }
  if (avgHours >= 1) {
    const hours = Math.round(avgHours);
    return `${hours}h`;
  }
  return '< 1h';
}

function calculateAvgResponseTime(
  responseTimesMs: number[] | undefined,
  member: TeamMember
): string {
  if (responseTimesMs && responseTimesMs.length > 0) {
    const avgMs = responseTimesMs.reduce((sum, t) => sum + t, 0) / responseTimesMs.length;
    return formatDuration(avgMs);
  }

  // Fallback: estimate based on workload
  if (member.ticketsAssigned > 10) {
    return '> 4 hours';
  }
  if (member.ticketsAssigned > 5) {
    return '2-4 hours';
  }
  return '< 2 hours';
}

function calculateAvgResolutionTime(resolutionTimesMs: number[] | undefined): string {
  if (!resolutionTimesMs || resolutionTimesMs.length === 0) {
    return '-';
  }

  const avgMs = resolutionTimesMs.reduce((sum, t) => sum + t, 0) / resolutionTimesMs.length;
  return formatDuration(avgMs);
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

async function getFirstResponseTimeMs(
  devopsService: AzureDevOpsService,
  ticket: Ticket,
  internalDomain: string
): Promise<{ memberEmail: string; responseTimeMs: number } | null> {
  try {
    const comments = await devopsService.getWorkItemComments(ticket.project, ticket.id);
    if (comments.length === 0) return null;

    // Sort comments by creation date ascending (earliest first)
    const sorted = [...comments].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const requesterEmail = ticket.requester?.email?.toLowerCase() || '';

    for (const comment of sorted) {
      const authorEmail = comment.author?.email?.toLowerCase() || '';
      if (!authorEmail) continue;
      if (!isInternalUser(authorEmail, internalDomain)) continue;
      if (requesterEmail && authorEmail === requesterEmail) continue;

      const responseTimeMs = comment.createdAt.getTime() - ticket.createdAt.getTime();
      if (responseTimeMs <= 0) continue;

      const assigneeEmail = ticket.assignee?.email?.toLowerCase();
      if (!assigneeEmail) return null;

      return { memberEmail: assigneeEmail, responseTimeMs };
    }

    return null;
  } catch (error) {
    console.error(
      `Error computing first response time for ticket ${ticket.project}/${ticket.id}:`,
      error
    );
    return null;
  }
}

async function fetchResponseTimes(
  devopsService: AzureDevOpsService,
  tickets: Ticket[],
  internalDomain: string
): Promise<Map<string, number[]>> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Filter to recent tickets with assignees, capped at 100 most recent
  const MAX_TICKETS = 100;
  const recentTickets = tickets
    .filter((t) => t.assignee?.email && t.createdAt >= thirtyDaysAgo)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, MAX_TICKETS);

  const memberResponseTimes = new Map<string, number[]>();
  const BATCH_SIZE = 10;

  for (let i = 0; i < recentTickets.length; i += BATCH_SIZE) {
    const batch = recentTickets.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((ticket) => getFirstResponseTimeMs(devopsService, ticket, internalDomain))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const { memberEmail, responseTimeMs } = result.value;
        if (!memberResponseTimes.has(memberEmail)) {
          memberResponseTimes.set(memberEmail, []);
        }
        memberResponseTimes.get(memberEmail)!.push(responseTimeMs);
      }
    }
  }

  return memberResponseTimes;
}

function isInternalUser(email: string, internalDomain: string): boolean {
  if (!email || !internalDomain) return false;
  // Check if the email belongs to the same domain as the current user
  const memberDomain = email.includes('@') ? email.split('@')[1].toLowerCase() : '';
  return memberDomain === internalDomain;
}
