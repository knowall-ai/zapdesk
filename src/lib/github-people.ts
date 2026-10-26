/**
 * Who is behind a GitHub account, for the routes that list GitHub issues.
 *
 * Server-only: it reads the GitHub usernames people saved on their Microsoft
 * profiles with the app's Graph token (#455), and the DevOps users those
 * people and `GITHUB_USER_MAP` entries resolve to.
 */

import { getGraphToken } from '@/lib/auth';
import { listLinkedGitHubAccounts } from '@/lib/graph';
import {
  devOpsUsersForGitHub,
  linkedGitHubAccounts,
  type GitHubIssuesConfig,
  type LinkedGitHubPerson,
} from '@/lib/github-issues';
import type { User } from '@/types';

export interface GitHubPeopleLookup {
  devOpsUsers: User[];
  linkedAccounts: Record<string, LinkedGitHubPerson>;
}

/** The GitHub usernames saved in a tenant, read through the shared per-tenant cache. */
export function loadLinkedGitHubAccounts(
  tenantId?: string | null
): Promise<Record<string, LinkedGitHubPerson>> {
  return linkedGitHubAccounts(async () => {
    const graphToken = await getGraphToken(tenantId);
    if (!graphToken) throw new Error('No Graph token');
    return listLinkedGitHubAccounts(graphToken);
  }, tenantId || '');
}

/**
 * The people GitHub accounts can resolve to in this DevOps organization.
 *
 * The DevOps user list is only read when there is someone to match: a
 * `GITHUB_USER_MAP` entry or a saved username.
 */
export async function gitHubPeopleFor(
  organization: string,
  config: GitHubIssuesConfig,
  loadDevOpsUsers: () => Promise<User[]>,
  tenantId?: string | null
): Promise<GitHubPeopleLookup> {
  const linkedAccounts = await loadLinkedGitHubAccounts(tenantId);
  const needsDevOpsUsers =
    Object.keys(config.userMap).length > 0 || Object.keys(linkedAccounts).length > 0;
  const devOpsUsers = needsDevOpsUsers
    ? await devOpsUsersForGitHub(organization, loadDevOpsUsers)
    : [];
  return { devOpsUsers, linkedAccounts };
}
