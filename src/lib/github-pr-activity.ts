/**
 * GitHub pull requests for the Kanban board's activity summary (#483).
 *
 * The summary counted Azure DevOps pull requests only, so work done in GitHub
 * repositories never showed. This reads the pull requests of the repositories
 * mapped to each DevOps project (the same mapping and credentials as GitHub
 * issues), and shows each author as the DevOps person they are.
 *
 * Server-only.
 */

import {
  GitHubApiError,
  gitHubUserToPerson,
  isOrgWildcard,
  type GitHubCredential,
  type GitHubPeople,
} from '@/lib/github-issues';
import type { DevOpsProject, PullRequestActivity, PullRequestActivityKind } from '@/types';

const GITHUB_API_URL = 'https://api.github.com';
const GITHUB_TIMEOUT_MS = 15_000;
const PAGE_SIZE = 100;
/** Ceiling on pages read per repository or organization, newest first. */
const MAX_PAGES = 3;

/** A pull request as the two GitHub endpoints used here both describe it. */
export interface GitHubPullRequest {
  number: number;
  title: string;
  html_url: string;
  state: string;
  user: { id: number; login: string; avatar_url?: string } | null;
  body?: string | null;
  created_at: string;
  updated_at: string;
  /** On the pulls endpoint. */
  merged_at?: string | null;
  /** On the search endpoint, which describes pull requests as issues. */
  pull_request?: { merged_at?: string | null } | null;
  /** On the search endpoint: `https://api.github.com/repos/owner/name`. */
  repository_url?: string;
}

/** Azure Boards work items a pull request names: `AB#123` in its title or description. */
export function linkedWorkItemIds(pr: Pick<GitHubPullRequest, 'title' | 'body'>): number[] {
  const ids = new Set<number>();
  for (const match of `${pr.title}\n${pr.body ?? ''}`.matchAll(/\bAB#(\d+)\b/gi)) {
    ids.add(Number(match[1]));
  }
  return [...ids];
}

/**
 * What a pull request did since `since`: opened, merged, or (opened earlier,
 * still open, and changed) updated. Empty when nothing happened in the window.
 *
 * GitHub's list gives no push date, so "updated" is any change to an open
 * pull request, a little wider than DevOps' "new commits pushed".
 */
export function gitHubActivity(pr: GitHubPullRequest, since: number): PullRequestActivityKind[] {
  const kinds: PullRequestActivityKind[] = [];
  const mergedAt = pr.merged_at ?? pr.pull_request?.merged_at ?? null;
  const created = Date.parse(pr.created_at) >= since;
  const merged = mergedAt !== null && Date.parse(mergedAt) >= since;
  if (created) kinds.push('created');
  if (!created && !merged && pr.state === 'open' && Date.parse(pr.updated_at) >= since) {
    kinds.push('updated');
  }
  if (merged) kinds.push('merged');
  return kinds;
}

async function gitHubGet<T>(url: string, token: string, scope: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new GitHubApiError(response.status, `GitHub returned ${response.status} for ${scope}`);
  }
  return (await response.json()) as T;
}

/** A repository's pull requests changed since `since`, most recently changed first. */
export async function fetchRepoPullRequests(
  repo: string,
  token: string,
  since: number
): Promise<GitHubPullRequest[]> {
  const found: GitHubPullRequest[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await gitHubGet<GitHubPullRequest[]>(
      `${GITHUB_API_URL}/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=${PAGE_SIZE}&page=${page}`,
      token,
      repo
    );
    const recent = batch.filter((pr) => Date.parse(pr.updated_at) >= since);
    found.push(...recent);
    // Sorted by last change, so the first older one ends the window.
    if (batch.length < PAGE_SIZE || recent.length < batch.length) break;
  }
  return found;
}

/**
 * Pull requests changed since `since` in every repository of an organization
 * (an `owner/*` mapping), through search: one query for the whole
 * organization rather than one per repository. Each carries its repository.
 */
export async function fetchOrgPullRequests(
  wildcard: string,
  token: string,
  since: number
): Promise<GitHubPullRequest[]> {
  const owner = wildcard.slice(0, -2);
  const day = new Date(since).toISOString().slice(0, 10);
  const query = encodeURIComponent(`org:${owner} is:pr updated:>=${day}`);
  const found: GitHubPullRequest[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await gitHubGet<{ items?: GitHubPullRequest[] }>(
      `${GITHUB_API_URL}/search/issues?q=${query}&sort=updated&order=desc&per_page=${PAGE_SIZE}&page=${page}`,
      token,
      wildcard
    );
    const batch = data.items ?? [];
    // Search matches whole days; keep only what falls in the window.
    found.push(...batch.filter((pr) => Date.parse(pr.updated_at) >= since));
    if (batch.length < PAGE_SIZE) break;
  }
  return found;
}

const repoFromUrl = (url?: string) => url?.match(/\/repos\/([^/]+\/[^/]+)$/)?.[1] ?? null;

export interface GitHubPullRequestSource {
  token: string;
  projectRepos: Record<string, string[]>;
  credentialFor?: (repo: string) => GitHubCredential | undefined;
}

/**
 * Pull request activity since `since` in the GitHub repositories mapped to
 * the given projects, with each author shown as their DevOps person.
 *
 * Only projects in `projects` are read, so a user never sees pull requests of
 * a project they cannot see. A repository mapped to more than one project is
 * counted under the first; an `owner/*` mapping skips the repositories the
 * mapping names for a project. `failedProjects` names the projects with a
 * repository that could not be read.
 */
export async function getGitHubPullRequestActivity(
  projects: DevOpsProject[],
  source: GitHubPullRequestSource,
  people: GitHubPeople,
  since: Date
): Promise<{ pullRequests: PullRequestActivity[]; failedProjects: string[] }> {
  const sinceMs = since.getTime();
  const byName = new Map(projects.map((p) => [p.name.toLowerCase(), p]));
  const namedRepos = new Set(
    Object.values(source.projectRepos)
      .flat()
      .filter((entry) => !isOrgWildcard(entry))
      .map((entry) => entry.toLowerCase())
  );
  const targets: Array<{ repo: string; project: string }> = [];
  const seen = new Set<string>();
  for (const [projectName, repos] of Object.entries(source.projectRepos)) {
    const project = byName.get(projectName.toLowerCase());
    if (!project) continue;
    for (const repo of repos) {
      const key = repo.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ repo, project: project.name });
    }
  }

  const settled = await Promise.allSettled(
    targets.map(({ repo }) => {
      const token = source.credentialFor?.(repo)?.token ?? source.token;
      return isOrgWildcard(repo)
        ? fetchOrgPullRequests(repo, token, sinceMs)
        : fetchRepoPullRequests(repo, token, sinceMs);
    })
  );

  const pullRequests: PullRequestActivity[] = [];
  const failedProjects = new Set<string>();
  settled.forEach((result, index) => {
    const { repo, project } = targets[index];
    if (result.status === 'rejected') {
      console.error(`[GitHub] Failed to read pull requests from ${repo}:`, result.reason);
      failedProjects.add(project);
      return;
    }
    const wholeOrg = isOrgWildcard(repo);
    for (const pr of result.value) {
      const prRepo = wholeOrg ? repoFromUrl(pr.repository_url) : repo;
      if (!prRepo) continue;
      if (wholeOrg && (namedRepos.has(prRepo.toLowerCase()) || seen.has(prRepo.toLowerCase()))) {
        continue;
      }
      const activity = gitHubActivity(pr, sinceMs);
      if (activity.length === 0 || !pr.user) continue;
      pullRequests.push({
        id: pr.number,
        title: pr.title,
        project,
        repository: prRepo,
        url: pr.html_url,
        author: gitHubUserToPerson(pr.user, people),
        createdAt: pr.created_at,
        closedAt: pr.merged_at ?? pr.pull_request?.merged_at ?? undefined,
        activity,
        workItemIds: linkedWorkItemIds(pr),
        source: 'github',
      });
    }
  });

  return { pullRequests, failedProjects: [...failedProjects] };
}
