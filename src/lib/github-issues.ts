/**
 * GitHub issues shown beside Azure DevOps work items (#447).
 *
 * Read-only, and server-side only: issues are fetched with one token held by
 * the server (`GITHUB_TOKEN`), the same way email ingest uses the DevOps PAT.
 * Which repositories belong to which DevOps project comes from
 * `GITHUB_PROJECT_REPOS`.
 */

import type { DevOpsProject, Organization, Ticket } from '@/types';

const GITHUB_API_URL = 'https://api.github.com';
const GITHUB_TIMEOUT_MS = 15_000;
const PAGE_SIZE = 100;
/** Ceiling on open issues read per repository (5 requests). */
const MAX_OPEN_PAGES = 5;
/** Closed issues are only needed for the "recently" views, which look back a week. */
const CLOSED_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * How long a repository's issues are reused. The token's rate limit is shared
 * by every ZapDesk user, so a page reload must not cost a round of requests.
 */
const ISSUES_CACHE_TTL_MS = 60 * 1000;

/** `owner/repo`, with the characters GitHub allows in each half. */
const REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

interface GitHubUser {
  id: number;
  login: string;
  avatar_url?: string;
}

/** The fields of a GitHub REST issue that ZapDesk reads. */
export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  state: string;
  html_url: string;
  user: GitHubUser | null;
  assignee?: GitHubUser | null;
  assignees?: GitHubUser[] | null;
  labels?: Array<string | { name?: string | null }> | null;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  // Present only on pull requests, which the issues endpoint also returns
  pull_request?: unknown;
}

export class GitHubApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

/**
 * Read the project to repositories mapping from `GITHUB_PROJECT_REPOS`.
 *
 * The value is JSON: `{"Project name": ["owner/repo", "owner/other"]}`. A
 * single repository may be given as a plain string. Anything unusable is
 * dropped with a warning rather than failing every request: one mistyped
 * repository should not take the valid ones down with it.
 */
export function parseProjectRepos(raw: string | undefined): Record<string, string[]> {
  const value = (raw || '').trim();
  if (!value) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    console.warn('[GitHub] GITHUB_PROJECT_REPOS is not valid JSON; no GitHub issues are shown.');
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    console.warn('[GitHub] GITHUB_PROJECT_REPOS must be a JSON object of project to repositories.');
    return {};
  }

  const mapping: Record<string, string[]> = {};
  for (const [project, repos] of Object.entries(parsed)) {
    const list = typeof repos === 'string' ? [repos] : Array.isArray(repos) ? repos : [];
    const valid: string[] = [];
    for (const repo of list) {
      const name = typeof repo === 'string' ? repo.trim() : '';
      if (REPO_PATTERN.test(name)) {
        if (!valid.includes(name)) valid.push(name);
      } else {
        console.warn(
          `[GitHub] GITHUB_PROJECT_REPOS: ignoring ${JSON.stringify(repo)} for project "${project}"; expected "owner/repo".`
        );
      }
    }
    if (project.trim() && valid.length > 0) mapping[project.trim()] = valid;
  }
  return mapping;
}

/** The server token and mapping, or null when either is missing. */
export function gitHubIssuesConfig(): {
  token: string;
  projectRepos: Record<string, string[]>;
} | null {
  const token = (process.env.GITHUB_TOKEN || '').trim();
  if (!token) return null;
  const projectRepos = parseProjectRepos(process.env.GITHUB_PROJECT_REPOS);
  if (Object.keys(projectRepos).length === 0) return null;
  return { token, projectRepos };
}

/** Map a GitHub issue onto the ticket shape the list already renders. */
export function gitHubIssueToTicket(
  issue: GitHubIssue,
  repo: string,
  project: string,
  organization?: Organization
): Ticket {
  const closed = issue.state === 'closed';
  const state = closed ? 'Closed' : 'Open';
  const assignee = issue.assignee ?? issue.assignees?.[0] ?? undefined;
  const author = issue.user;

  return {
    // GitHub's own id, negated: unique across repositories, and it can never
    // collide with a DevOps work item id, which is always positive.
    id: -issue.id,
    workItemId: issue.number,
    source: 'github',
    sourceUrl: issue.html_url,
    sourceRef: `${repo}#${issue.number}`,
    title: issue.title,
    // The body is Markdown and the ticket views render HTML. The row links to
    // GitHub for the detail, so it is not carried over.
    description: '',
    status: state,
    devOpsState: state,
    workItemType: 'Issue',
    requester: {
      id: author ? `github:${author.id}` : 'github:unknown',
      displayName: author?.login || 'Unknown',
      email: '',
      timezone: '',
      tags: [],
      avatarUrl: author?.avatar_url,
    },
    assignee: assignee
      ? {
          id: `github:${assignee.id}`,
          displayName: assignee.login,
          email: '',
          avatarUrl: assignee.avatar_url,
        }
      : undefined,
    organization,
    tags: (issue.labels || [])
      .map((label) => (typeof label === 'string' ? label : label.name || ''))
      .filter(Boolean),
    createdAt: new Date(issue.created_at),
    updatedAt: new Date(issue.updated_at),
    resolvedAt: issue.closed_at ? new Date(issue.closed_at) : undefined,
    devOpsUrl: issue.html_url,
    project,
    comments: [],
  };
}

async function fetchIssuePage(repo: string, token: string, query: string): Promise<GitHubIssue[]> {
  const response = await fetch(`${GITHUB_API_URL}/repos/${repo}/issues?${query}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });

  if (!response.ok) {
    const rateLimited =
      (response.status === 403 || response.status === 429) &&
      response.headers.get('x-ratelimit-remaining') === '0';
    throw new GitHubApiError(
      response.status,
      rateLimited
        ? `GitHub rate limit reached while reading ${repo}`
        : `GitHub returned ${response.status} for ${repo}`
    );
  }

  const data: unknown = await response.json();
  return Array.isArray(data) ? (data as GitHubIssue[]) : [];
}

/**
 * Open issues in a repository, plus those closed in the last week.
 *
 * Pull requests are dropped: GitHub's issues endpoint returns them too.
 */
export async function fetchRepoIssues(repo: string, token: string): Promise<GitHubIssue[]> {
  const issues: GitHubIssue[] = [];

  for (let page = 1; page <= MAX_OPEN_PAGES; page++) {
    const batch = await fetchIssuePage(
      repo,
      token,
      `state=open&per_page=${PAGE_SIZE}&page=${page}`
    );
    issues.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  const since = new Date(Date.now() - CLOSED_LOOKBACK_MS).toISOString();
  issues.push(
    ...(await fetchIssuePage(
      repo,
      token,
      `state=closed&since=${encodeURIComponent(since)}&per_page=${PAGE_SIZE}`
    ))
  );

  return issues.filter((issue) => !issue.pull_request);
}

const issuesCache = new Map<string, { issues: GitHubIssue[]; timestamp: number }>();

/** For tests: forget every cached repository. */
export function clearGitHubIssuesCache(): void {
  issuesCache.clear();
}

async function cachedRepoIssues(repo: string, token: string): Promise<GitHubIssue[]> {
  const cached = issuesCache.get(repo);
  if (cached && Date.now() - cached.timestamp < ISSUES_CACHE_TTL_MS) return cached.issues;
  const issues = await fetchRepoIssues(repo, token);
  issuesCache.set(repo, { issues, timestamp: Date.now() });
  return issues;
}

export interface GitHubTicketsResult {
  tickets: Ticket[];
  /** Repositories that could not be read; the rest are still returned. */
  failedRepos: string[];
}

/**
 * GitHub issues for the given DevOps projects, as tickets.
 *
 * Only projects in `projects` are considered, so a caller passing the projects
 * a user can see in DevOps never returns issues mapped to a project they
 * cannot. Project names match case-insensitively. A repository mapped to more
 * than one project is listed under the first.
 */
export async function getGitHubTickets(
  projects: DevOpsProject[],
  devOpsOrg: string,
  config: { token: string; projectRepos: Record<string, string[]> }
): Promise<GitHubTicketsResult> {
  const byName = new Map(projects.map((p) => [p.name.toLowerCase(), p]));
  const targets: Array<{ repo: string; project: DevOpsProject }> = [];
  const seen = new Set<string>();

  for (const [projectName, repos] of Object.entries(config.projectRepos)) {
    const project = byName.get(projectName.toLowerCase());
    if (!project) continue;
    for (const repo of repos) {
      const key = repo.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ repo, project });
    }
  }

  const settled = await Promise.allSettled(
    targets.map(({ repo }) => cachedRepoIssues(repo, config.token))
  );

  const tickets: Ticket[] = [];
  const failedRepos: string[] = [];
  settled.forEach((result, index) => {
    const { repo, project } = targets[index];
    if (result.status === 'rejected') {
      console.error(`[GitHub] Failed to read issues from ${repo}:`, result.reason);
      failedRepos.push(repo);
      return;
    }
    const organization: Organization = {
      id: project.id,
      name: project.name,
      devOpsProject: project.name,
      devOpsOrg,
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    for (const issue of result.value) {
      tickets.push(gitHubIssueToTicket(issue, repo, project.name, organization));
    }
  });

  return { tickets, failedRepos };
}
