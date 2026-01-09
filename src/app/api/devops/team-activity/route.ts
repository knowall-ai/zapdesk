import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';
import type { User } from '@/types';

interface ActivityData {
  date: string;
  count: number;
  level: number;
}

interface TeamActivityResponse {
  activities: ActivityData[];
  members: User[];
  totalActivities: number;
}

function generateDateRange(startDate: Date, endDate: Date): string[] {
  const dates: string[] = [];
  const current = new Date(startDate);

  while (current <= endDate) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function getActivityLevel(count: number, maxCount: number): number {
  if (count === 0) return 0;
  if (maxCount === 0) return 0;

  const ratio = count / maxCount;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const memberFilter = searchParams.get('member');

    const devopsService = new AzureDevOpsService(session.accessToken);
    const tickets = await devopsService.getAllTickets();

    // Collect all team members from projects
    const memberMap = new Map<string, User>();
    const projects = await devopsService.getProjects();

    // Fetch team members from all projects in parallel for better performance
    const memberResults = await Promise.allSettled(
      projects.map((project) => devopsService.getTeamMembers(project.name))
    );

    for (let i = 0; i < memberResults.length; i++) {
      const result = memberResults[i];
      if (result.status === 'fulfilled') {
        for (const member of result.value) {
          if (!memberMap.has(member.id)) {
            memberMap.set(member.id, member);
          }
        }
      } else {
        console.error(
          `Failed to get team members for ${projects[i].name}:`,
          result.reason instanceof Error ? result.reason.message : result.reason
        );
      }
    }

    const allMembers = Array.from(memberMap.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );

    // Calculate date range (last 365 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 1);
    startDate.setDate(startDate.getDate() + 1);

    const dateRange = generateDateRange(startDate, endDate);

    // Count activities per day (tickets created or updated by team members)
    const activityByDate = new Map<string, number>();

    // Initialize all dates with 0
    for (const date of dateRange) {
      activityByDate.set(date, 0);
    }

    // Filter tickets by team member if specified, otherwise show all ticket activity
    const relevantTickets =
      memberFilter && memberFilter !== 'all'
        ? tickets.filter((ticket) => ticket.assignee?.id === memberFilter)
        : tickets; // Show all tickets for overall team activity

    // Count activities by date
    for (const ticket of relevantTickets) {
      // Count created date
      const createdDate = ticket.createdAt.toISOString().split('T')[0];
      if (activityByDate.has(createdDate)) {
        activityByDate.set(createdDate, (activityByDate.get(createdDate) || 0) + 1);
      }

      // Count updated date if different from created
      const updatedDate = ticket.updatedAt.toISOString().split('T')[0];
      if (updatedDate !== createdDate && activityByDate.has(updatedDate)) {
        activityByDate.set(updatedDate, (activityByDate.get(updatedDate) || 0) + 1);
      }
    }

    // Find max count for level calculation
    const counts = Array.from(activityByDate.values());
    const maxCount = Math.max(...counts, 1);

    // Convert to activity data format
    const activities: ActivityData[] = dateRange.map((date) => {
      const count = activityByDate.get(date) || 0;
      return {
        date,
        count,
        level: getActivityLevel(count, maxCount),
      };
    });

    const totalActivities = counts.reduce((sum, c) => sum + c, 0);

    const response: TeamActivityResponse = {
      activities,
      members: allMembers,
      totalActivities,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching team activity:', error);
    return NextResponse.json({ error: 'Failed to fetch team activity' }, { status: 500 });
  }
}
