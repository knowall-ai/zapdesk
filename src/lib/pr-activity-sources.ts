import type { AzureDevOpsService } from '@/lib/devops';
import { gitHubAvailable, gitHubSourceFor } from '@/lib/github-source';
import { gitHubPeopleFor } from '@/lib/github-people';
import { getGitHubPullRequestActivity } from '@/lib/github-pr-activity';
import type { PullRequestActivity } from '@/types';

/** The session fields pull request collection needs. */
export interface PullRequestSession {
  accessToken?: string;
  tenantId?: string | null;
}

export interface CollectedPullRequests {
  pullRequests: PullRequestActivity[];
  /** Projects whose pull requests could not be read. */
  failedProjects: string[];
}

/** Which sources `?sources=` asks for: the header toggle's value, anything else is both. */
export function sourcesRequested(value: string | null): {
  includeDevOps: boolean;
  includeGitHub: boolean;
} {
  return {
    includeDevOps: value !== 'github',
    includeGitHub: value !== 'devops' && gitHubAvailable(),
  };
}

/**
 * Pull requests opened, pushed to or merged since `since`, from Azure DevOps
 * and from GitHub (#483), merged and newest first. Shared by the Kanban
 * activity summary and the Team page's history chart, so both follow the
 * header toggle the same way.
 */
export async function collectPullRequests(
  devopsService: AzureDevOpsService,
  organization: string,
  session: PullRequestSession,
  since: Date,
  sources: string | null
): Promise<CollectedPullRequests> {
  const { includeDevOps, includeGitHub } = sourcesRequested(sources);

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
  return { pullRequests, failedProjects };
}

/**
 * GitHub pull requests for the projects this user can see, or null when none
 * are mapped. A GitHub failure marks its projects incomplete instead of
 * failing the DevOps counts too.
 */
async function gitHubActivity(
  devopsService: AzureDevOpsService,
  organization: string,
  session: PullRequestSession,
  since: Date
): Promise<CollectedPullRequests | null> {
  // Everything inside the try, project loading too: a GitHub-side failure must
  // never cost the DevOps counts.
  let projects: Awaited<ReturnType<AzureDevOpsService['getProjects']>> = [];
  try {
    projects = await devopsService.getProjects();
    const source = await gitHubSourceFor(organization, projects, session.accessToken ?? '');
    if (!source) return null;
    const { devOpsUsers, linkedAccounts } = await gitHubPeopleFor(
      organization,
      source,
      () => devopsService.getOrganizationUsers(),
      session.tenantId
    );
    return await getGitHubPullRequestActivity(
      projects,
      source,
      { userMap: source.userMap, devOpsUsers, linkedAccounts },
      since
    );
  } catch (error) {
    console.error('Error fetching GitHub pull request activity:', error);
    return { pullRequests: [], failedProjects: projects.map((p) => p.name) };
  }
}
