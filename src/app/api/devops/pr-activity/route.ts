import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { validateOrganizationAccess } from '@/lib/devops-auth';
import { AzureDevOpsService } from '@/lib/devops';
import { ACTIVITY_WINDOW_MS, MAX_ACTIVITY_LOOKBACK_MS } from '@/lib/activity-summary';
import type { PullRequestActivityResponse } from '@/types';

/**
 * Pull requests opened, pushed to or merged since `?since=` (ISO 8601), for
 * the Kanban board's per-project and per-person activity summary.
 *
 * The browser works the window out, because skipping the weekend depends on
 * the user's timezone. Without one, or with one out of range, it's the last
 * 24 hours.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const organization = request.headers.get('x-devops-org');
    if (!organization) {
      return NextResponse.json({ error: 'No organization specified' }, { status: 400 });
    }

    const hasAccess = await validateOrganizationAccess(session.accessToken, organization);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const now = Date.now();
    const requested = Date.parse(new URL(request.url).searchParams.get('since') ?? '');
    const since = new Date(
      Number.isFinite(requested) && requested <= now && now - requested <= MAX_ACTIVITY_LOOKBACK_MS
        ? requested
        : now - ACTIVITY_WINDOW_MS
    );
    const devopsService = new AzureDevOpsService(session.accessToken, organization);
    const { pullRequests, failedProjects } = await devopsService.getPullRequestActivity(since);

    const response: PullRequestActivityResponse = {
      since: since.toISOString(),
      pullRequests,
      ...(failedProjects.length > 0 ? { failedProjects } : {}),
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching pull request activity:', error);
    return NextResponse.json({ error: 'Failed to fetch pull request activity' }, { status: 500 });
  }
}
