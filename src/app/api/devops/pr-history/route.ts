import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { validateOrganizationAccess } from '@/lib/devops-auth';
import { AzureDevOpsService } from '@/lib/devops';
import { collectPullRequests } from '@/lib/pr-activity-sources';
import { parseHistoryRange } from '@/lib/pr-history';
import type { PullRequestActivityResponse } from '@/types';

/**
 * Pull requests opened or merged in the last `?days=` (7, 30, 90 or 365; 30
 * when absent), for the Live Dashboard's pull request chart.
 *
 * The Kanban board's `pr-activity` route looks back a week at most, because
 * its job is "what happened since the last stand-up". This one answers "how
 * is the flow of pull requests changing", so it reaches further and the
 * browser buckets the result by day, week or month.
 *
 * Azure DevOps and GitHub pull requests both count; `?sources=devops` or
 * `?sources=github` follows the header toggle, anything else is both.
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

    const params = new URL(request.url).searchParams;
    const days = parseHistoryRange(params.get('days'));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const devopsService = new AzureDevOpsService(session.accessToken, organization);
    const { pullRequests, failedProjects } = await collectPullRequests(
      devopsService,
      organization,
      session,
      since,
      params.get('sources')
    );

    const response: PullRequestActivityResponse = {
      since: since.toISOString(),
      pullRequests,
      ...(failedProjects.length > 0 ? { failedProjects } : {}),
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching pull request history:', error);
    return NextResponse.json({ error: 'Failed to fetch pull request history' }, { status: 500 });
  }
}
