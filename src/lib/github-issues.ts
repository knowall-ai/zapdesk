/**
 * GitHub issues shown beside Azure DevOps work items (#447).
 *
 * Read-only, and server-side only: issues are fetched with one token held by
 * the server (`GITHUB_TOKEN`), the same way email ingest uses the DevOps PAT.
 * Which repositories belong to which DevOps project comes from
 * `GITHUB_PROJECT_REPOS`, and which GitHub account is which DevOps user from
 * `GITHUB_USER_MAP`.
 */

import type { DevOpsProject, Organization, Ticket, User } from '@/types';

const GITHUB_API_URL = 'https://api.github.com';
const GITHUB_TIMEOUT_MS = 15_000;
const PAGE_SIZE = 100;
/** Ceiling on open issues read per repository (5 requests). */
const MAX_OPEN_PAGES = 5;
/**
 * Ceiling on pages read for a whole organization, open and closed alike. The
 * pages include pull requests, which are dropped afterwards.
 */
const MAX_ORG_PAGES = 10;
/** Closed issues are only needed for the "recently" views, which look back a week. */
const CLOSED_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * How long a repository's issues are reused. The token's rate limit is shared
 * by every ZapDesk user, so a page reload must not cost a round of requests.
 */
const ISSUES_CACHE_TTL_MS = 60 * 1000;

/** How long the DevOps user list behind `GITHUB_USER_MAP` is reused. */
const DEVOPS_USERS_CACHE_TTL_MS = 10 * 60 * 1000;

/** A GitHub username: letters, digits and single hyphens, up to 39 characters. */
const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** `owner/repo`, with the characters GitHub allows in each half. */
const REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
/** `owner/*`: every repository of a GitHub organization. */
const ORG_WILDCARD_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/\*$/;

/** True for an `owner/*` entry, which stands for a whole GitHub organization. */
export function isOrgWildcard(entry: string): boolean {
  return ORG_WILDCARD_PATTERN.test(entry);
}

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
  // Present when issues are listed for a whole organization
  repository?: { full_name?: string | null } | null;
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
 * The value is JSON: `{"Project name": ["owner/repo", "owner/other"]}`. An
 * entry of `owner/*` stands for every repository of that GitHub organization.
 * A single entry may be given as a plain string. Anything unusable is
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
      if (REPO_PATTERN.test(name) || ORG_WILDCARD_PATTERN.test(name)) {
        if (!valid.includes(name)) valid.push(name);
      } else {
        console.warn(
          `[GitHub] GITHUB_PROJECT_REPOS: ignoring ${JSON.stringify(repo)} for project "${project}"; expected "owner/repo" or "owner/*".`
        );
      }
    }
    if (project.trim() && valid.length > 0) mapping[project.trim()] = valid;
  }
  return mapping;
}

/**
 * Read the GitHub username to DevOps user mapping from `GITHUB_USER_MAP`.
 *
 * The value is JSON: `{"github-username": "DevOps display name"}`. Nothing
 * links a GitHub account to a DevOps user, so without it the same person shows
 * up twice: once under each name. Usernames are keyed in lower case, because
 * GitHub treats them without regard to case. Unusable entries are dropped with
 * a warning.
 */
export function parseUserMap(raw: string | undefined): Record<string, string> {
  const value = (raw || '').trim();
  if (!value) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    console.warn('[GitHub] GITHUB_USER_MAP is not valid JSON; GitHub usernames are shown as is.');
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    console.warn('[GitHub] GITHUB_USER_MAP must be a JSON object of GitHub username to name.');
    return {};
  }

  const mapping: Record<string, string> = {};
  for (const [login, name] of Object.entries(parsed)) {
    const username = login.trim();
    const displayName = typeof name === 'string' ? name.trim() : '';
    if (LOGIN_PATTERN.test(username) && displayName) {
      mapping[username.toLowerCase()] = displayName;
    } else {
      console.warn(
        `[GitHub] GITHUB_USER_MAP: ignoring ${JSON.stringify(login)}; expected a GitHub username and a name.`
      );
    }
  }
  return mapping;
}

/** What is needed to show a GitHub account as the DevOps user it belongs to. */
export interface GitHubPeople {
  /** GitHub username, in lower case, to DevOps display name. */
  userMap: Record<string, string>;
  /** DevOps users to take the id, address and avatar from, when they could be read. */
  devOpsUsers?: User[];
}

export interface GitHubIssuesConfig {
  token: string;
  projectRepos: Record<string, string[]>;
  userMap: Record<string, string>;
}

/** The server token and mappings, or null when the token or the repositories are missing. */
export function gitHubIssuesConfig(): GitHubIssuesConfig | null {
  const token = (process.env.GITHUB_TOKEN || '').trim();
  if (!token) return null;
  const projectRepos = parseProjectRepos(process.env.GITHUB_PROJECT_REPOS);
  if (Object.keys(projectRepos).length === 0) return null;
  return { token, projectRepos, userMap: parseUserMap(process.env.GITHUB_USER_MAP) };
}

/**
 * A GitHub account as the person to show.
 *
 * A mapped account takes the DevOps display name, so the Kanban board groups
 * its issues with that person's DevOps work. When the DevOps user of that name
 * is known it is used whole, which also makes "assigned to me" views match.
 * An unmapped account is shown by its GitHub username.
 */
export function gitHubUserToPerson(account: GitHubUser, people?: GitHubPeople): User {
  const gitHubPerson: User = {
    id: `github:${account.id}`,
    displayName: account.login,
    email: '',
    avatarUrl: account.avatar_url,
  };

  const mappedName = people?.userMap[account.login.toLowerCase()];
  if (!mappedName) return gitHubPerson;

  const devOpsUser = people?.devOpsUsers?.find(
    (user) => user.displayName?.toLowerCase() === mappedName.toLowerCase()
  );
  if (!devOpsUser) return { ...gitHubPerson, displayName: mappedName };

  return {
    id: devOpsUser.id,
    displayName: devOpsUser.displayName,
    email: devOpsUser.email || '',
    avatarUrl: devOpsUser.avatarUrl ?? account.avatar_url,
  };
}

const devOpsUsersCache = new Map<string, { users: User[]; timestamp: number }>();

/** For tests: forget every cached DevOps user list. */
export function clearDevOpsUsersCache(): void {
  devOpsUsersCache.clear();
}

/**
 * The DevOps users of an organization, for matching `GITHUB_USER_MAP` names.
 *
 * Best effort: listing users needs a permission not every signed-in user has,
 * and a failure here only means mapped people are shown by name without their
 * DevOps identity. An empty answer is not cached, so the next request by
 * someone who can list users fills it in.
 */
export async function devOpsUsersForGitHub(
  devOpsOrg: string,
  load: () => Promise<User[]>
): Promise<User[]> {
  const cached = devOpsUsersCache.get(devOpsOrg);
  if (cached && Date.now() - cached.timestamp < DEVOPS_USERS_CACHE_TTL_MS) return cached.users;
  try {
    const users = await load();
    if (users.length > 0) devOpsUsersCache.set(devOpsOrg, { users, timestamp: Date.now() });
    return users;
  } catch (error) {
    console.error('[GitHub] Could not list DevOps users for GITHUB_USER_MAP:', error);
    return [];
  }
}

/** Map a GitHub issue onto the ticket shape the list already renders. */
export function gitHubIssueToTicket(
  issue: GitHubIssue,
  repo: string,
  project: string,
  organization?: Organization,
  people?: GitHubPeople
): Ticket {
  const closed = issue.state === 'closed';
  const state = closed ? 'Closed' : 'Open';
  const assignee = issue.assignee ?? issue.assignees?.[0] ?? undefined;
  const author = issue.user ? gitHubUserToPerson(issue.user, people) : null;

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
      id: author?.id ?? 'github:unknown',
      displayName: author?.displayName || 'Unknown',
      email: author?.email ?? '',
      timezone: '',
      tags: [],
      avatarUrl: author?.avatarUrl,
    },
    assignee: assignee ? gitHubUserToPerson(assignee, people) : undefined,
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

/**
 * One page of issues. `scope` is `owner/repo` for a repository, or `owner/*`
 * for every repository of an organization the token can read.
 */
async function fetchIssuePage(scope: string, token: string, query: string): Promise<GitHubIssue[]> {
  const url = isOrgWildcard(scope)
    ? `${GITHUB_API_URL}/orgs/${scope.slice(0, -2)}/issues?filter=all&${query}`
    : `${GITHUB_API_URL}/repos/${scope}/issues?${query}`;
  const response = await fetch(url, {
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
        ? `GitHub rate limit reached while reading ${scope}`
        : `GitHub returned ${response.status} for ${scope}`
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

/**
 * Open issues in every repository of an organization, plus those closed in
 * the last week. `wildcard` is the `owner/*` entry.
 *
 * One request stream for the whole organization, rather than two requests per
 * repository: an organization can have more repositories than the token's
 * rate limit would stand. Each issue carries the repository it belongs to.
 */
export async function fetchOrgIssues(wildcard: string, token: string): Promise<GitHubIssue[]> {
  const issues: GitHubIssue[] = [];
  const since = new Date(Date.now() - CLOSED_LOOKBACK_MS).toISOString();

  for (const query of ['state=open', `state=closed&since=${encodeURIComponent(since)}`]) {
    for (let page = 1; page <= MAX_ORG_PAGES; page++) {
      const batch = await fetchIssuePage(
        wildcard,
        token,
        `${query}&per_page=${PAGE_SIZE}&page=${page}`
      );
      issues.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      if (page === MAX_ORG_PAGES) {
        console.warn(
          `[GitHub] ${wildcard} has more than ${MAX_ORG_PAGES * PAGE_SIZE} items (${query.split('&')[0]}); the rest are not shown.`
        );
      }
    }
  }

  return issues.filter((issue) => !issue.pull_request && issue.repository?.full_name);
}

const issuesCache = new Map<string, { issues: GitHubIssue[]; timestamp: number }>();

/** For tests: forget every cached repository. */
export function clearGitHubIssuesCache(): void {
  issuesCache.clear();
}

async function cachedRepoIssues(repo: string, token: string): Promise<GitHubIssue[]> {
  const cached = issuesCache.get(repo);
  if (cached && Date.now() - cached.timestamp < ISSUES_CACHE_TTL_MS) return cached.issues;
  const issues = isOrgWildcard(repo)
    ? await fetchOrgIssues(repo, token)
    : await fetchRepoIssues(repo, token);
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
 *
 * An `owner/*` entry brings in every repository of that organization, except
 * the ones the mapping names for a project: those stay with their project, and
 * so stay hidden from a caller who cannot see it.
 *
 * `devOpsUsers` is only for `config.userMap`: the users whose identity a
 * mapped GitHub account takes.
 */
export async function getGitHubTickets(
  projects: DevOpsProject[],
  devOpsOrg: string,
  config: {
    token: string;
    projectRepos: Record<string, string[]>;
    userMap?: Record<string, string>;
  },
  devOpsUsers?: User[]
): Promise<GitHubTicketsResult> {
  const people: GitHubPeople = { userMap: config.userMap ?? {}, devOpsUsers };
  const byName = new Map(projects.map((p) => [p.name.toLowerCase(), p]));
  const targets: Array<{ repo: string; project: DevOpsProject }> = [];
  const seen = new Set<string>();

  // Every repository the mapping names, whether or not the caller can see its
  // project: a wildcard must not hand those out under another project.
  const namedRepos = new Set(
    Object.values(config.projectRepos)
      .flat()
      .filter((entry) => !isOrgWildcard(entry))
      .map((entry) => entry.toLowerCase())
  );

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
    const wholeOrg = isOrgWildcard(repo);
    for (const issue of result.value) {
      const issueRepo = wholeOrg ? issue.repository?.full_name : repo;
      if (!issueRepo) continue;
      const key = issueRepo.toLowerCase();
      if (wholeOrg && (namedRepos.has(key) || seen.has(key))) continue;
      tickets.push(gitHubIssueToTicket(issue, issueRepo, project.name, organization, people));
    }
  });

  return { tickets, failedRepos };
}
