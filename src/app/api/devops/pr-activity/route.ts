import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { validateOrganizationAccess } from '@/lib/devops-auth';
import { AzureDevOpsService } from '@/lib/devops';
import { ACTIVITY_WINDOW_MS, MAX_ACTIVITY_LOOKBACK_MS } from '@/lib/activity-summary';
import { gitHubAvailable, gitHubSourceFor } from '@/lib/github-source';
import { gitHubPeopleFor } from '@/lib/github-people';
import { getGitHubPullRequestActivity } from '@/lib/github-pr-activity';
import type { PullRequestActivity, PullRequestActivityResponse } from '@/types';

/**
 * Pull requests opened, pushed to or merged since `?since=` (ISO 8601), for
 * the Kanban board's per-project and per-person activity summary.
 *
 * The browser works the window out, because skipping the weekend depends on
 * the user's timezone. Without one, or with one out of range, it's the last
 * 24 hours.
 *
 * Azure DevOps and GitHub pull requests both count (#483); `?sources=devops`
 * or `?sources=github` follows the header toggle, anything else is both.
 * GitHub pull requests come from the repositories mapped to the projects the
 * user can see, with each author shown as their DevOps person.
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
    const sources = new URL(request.url).searchParams.get('sources');
    const includeDevOps = sources !== 'github';
    const includeGitHub = sources !== 'devops' && gitHubAvailable();

    const devopsService = new AzureDevOpsService(session.accessToken, organization);
    const [devops, github] = await Promise.all([
      includeDevOps
        ? devopsService.getPullRequestActivity(since)
        : { pullRequests: [] as PullRequestActivity[], failedProjects: [] as string[] },
      includeGitHub ? gitHubActivity(devopsService, organization, session, since) : null,
    ]);

    const pullRequests = [...devops.pullRequests, ...(github?.pullRequests ?? [])].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
    const failedProjects = [
      ...new Set([...devops.failedProjects, ...(github?.failedProjects ?? [])]),
    ];

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

/**
 * GitHub pull requests for the projects this user can see, or null when none
 * are mapped. A GitHub failure marks its projects incomplete instead of
 * failing the DevOps counts too.
 */
async function gitHubActivity(
  devopsService: AzureDevOpsService,
  organization: string,
  session: { accessToken?: string; tenantId?: string | null },
  since: Date
): Promise<{ pullRequests: PullRequestActivity[]; failedProjects: string[] } | null> {
  const projects = await devopsService.getProjects();
  try {
    const source = await gitHubSourceFor(organization, projects, session.accessToken ?? '');
    if (!source) return null;
    const { devOpsUsers, linkedAccounts } = await gitHubPeopleFor(
      organization,
      source,
      () => devopsService.getOrganizationUsers(),
      session.tenantId
    );
    const result = await getGitHubPullRequestActivity(
      projects,
      source,
      { userMap: source.userMap, devOpsUsers, linkedAccounts },
      since
    );
    return result;
  } catch (error) {
    console.error('Error fetching GitHub pull request activity:', error);
    return { pullRequests: [], failedProjects: projects.map((p) => p.name) };
  }
}
