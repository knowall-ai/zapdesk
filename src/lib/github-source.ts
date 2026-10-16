/**
 * Where GitHub issues come from (#457): the ZapDesk GitHub App, connected per
 * DevOps project, and/or the server's own token and repository mapping
 * (`GITHUB_TOKEN`, `GITHUB_PROJECT_REPOS`), which self-hosted copies use.
 *
 * Server-only.
 */

import { appProjectRepos, gitHubAppConfig, installationCredential } from '@/lib/github-app';
import {
  gitHubIssuesConfig,
  parseUserMap,
  type GitHubCredential,
  type GitHubIssuesConfig,
} from '@/lib/github-issues';
import type { DevOpsProject } from '@/types';

/** True when GitHub issues can be shown at all, so the UI offers the source toggle. */
export function gitHubAvailable(): boolean {
  return gitHubIssuesConfig() !== null || gitHubAppConfig() !== null;
}

/** True when admins can connect GitHub to their projects from ZapDesk. */
export function gitHubAppAvailable(): boolean {
  return gitHubAppConfig() !== null;
}

export interface GitHubSource extends GitHubIssuesConfig {
  /** The credential for a repository, when it is not the server's own token. */
  credentialFor?: (repo: string) => GitHubCredential | undefined;
  /** Installations that could not be read; shown like unreadable repositories. */
  failed: string[];
}

/**
 * The repositories mapped to the given projects and how to read each one, or
 * null when GitHub is not set up. Only the projects passed in are looked at.
 */
export async function gitHubSourceFor(
  org: string,
  projects: DevOpsProject[],
  accessToken: string
): Promise<GitHubSource | null> {
  const env = gitHubIssuesConfig();
  const app = gitHubAppConfig();
  if (!env && !app) return null;
  if (!app) return { ...env!, failed: [] };

  const mapping = await appProjectRepos(app, org, projects, accessToken);
  const projectRepos: Record<string, string[]> = { ...(env?.projectRepos ?? {}) };
  for (const [project, repos] of Object.entries(mapping.projectRepos)) {
    projectRepos[project] = [...(projectRepos[project] ?? []), ...repos];
  }

  return {
    token: env?.token ?? '',
    projectRepos,
    userMap: env?.userMap ?? parseUserMap(process.env.GITHUB_USER_MAP),
    credentialFor: (repo) => {
      const key = repo.toLowerCase();
      const token = mapping.tokens[key];
      return token ? { token, id: installationCredential(mapping.installations[key]) } : undefined;
    },
    failed: mapping.failed,
  };
}
