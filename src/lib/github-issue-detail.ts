/**
 * One GitHub issue, in enough detail for the ZapDesk pop-up (#566).
 *
 * The list endpoints read many issues cheaply and carry no body and no
 * comments; opening one reads it on its own. The body and the comments are
 * asked for as HTML -- GitHub renders its own Markdown, which is the only way
 * to get mentions, task lists and code blocks right without taking on a
 * Markdown library and then disagreeing with GitHub about the edges.
 *
 * Server-only: every function here takes a token.
 */

import { sanitizeEmailHtml } from './email-clean';
import { GitHubApiError, type GitHubIssue, type GitHubUser } from './github-issues';
import { gitHubLabelsAfterStatus, gitHubWriteForStatus } from './github-process';
import type { TicketStatus } from '@/types';

const GITHUB_API_URL = 'https://api.github.com';
const GITHUB_TIMEOUT_MS = 10_000;

/** Comments are a conversation, not a backlog: enough for a ticket, not a novel. */
const MAX_COMMENTS = 100;

/**
 * `html+json` gives `body_html` beside the raw body. The HTML is GitHub's own
 * rendering of the Markdown, so what ZapDesk shows is what GitHub shows.
 */
const HTML_ACCEPT = 'application/vnd.github.html+json';

interface GitHubComment {
  id: number;
  user: GitHubUser | null;
  body_html?: string | null;
  body?: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
}

interface IssueWithHtml extends GitHubIssue {
  body_html?: string | null;
  body?: string | null;
  comments?: number;
}

async function gitHub(
  path: string,
  token: string,
  init: RequestInit & { accept?: string } = {}
): Promise<Response> {
  const { accept, ...rest } = init;
  const response = await fetch(`${GITHUB_API_URL}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept ?? 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
      ...rest.headers,
    },
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });

  if (!response.ok) {
    const isWrite = (rest.method ?? 'GET').toUpperCase() !== 'GET';
    if (await isRateLimited(response)) {
      // 429 whatever GitHub sent: a rate-limited 403 is not a refusal, and
      // passing it on as 403 would read as a permission problem (#676).
      throw new GitHubApiError(429, describeRateLimit(response));
    }
    throw new GitHubApiError(response.status, describeFailure(response.status, path, isWrite));
  }
  return response;
}

/**
 * GitHub answers a rate-limited request with 429, or with 403 and either an
 * exhausted `x-ratelimit-remaining`, a `retry-after`, or a body that says so
 * (the secondary limit).
 */
async function isRateLimited(response: Response): Promise<boolean> {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  if (response.headers.get('x-ratelimit-remaining') === '0') return true;
  if (response.headers.has('retry-after')) return true;
  try {
    const body: unknown = await response.clone().json();
    const message =
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : '';
    return /rate limit/i.test(message);
  } catch {
    return false;
  }
}

/** How long to wait, from `retry-after` (seconds) or `x-ratelimit-reset` (epoch seconds). */
function describeRateLimit(response: Response): string {
  const retryAfter = Number(response.headers.get('retry-after'));
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  const seconds =
    Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter
      : Number.isFinite(reset) && reset > 0
        ? reset - Math.floor(Date.now() / 1000)
        : NaN;
  const base = 'GitHub is limiting how often ZapDesk can call it.';
  if (!Number.isFinite(seconds) || seconds <= 0) return `${base} Try again in a minute.`;
  const minutes = Math.ceil(seconds / 60);
  return `${base} Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

/**
 * What to tell the user, in words they can act on.
 *
 * Each cause gets its own message (#676). Every 401 and 403 used to say
 * "cannot write to this repository", even when the failing request was a
 * read, or the token had simply expired.
 */
function describeFailure(status: number, path: string, isWrite: boolean): string {
  if (status === 401) {
    return "GitHub did not accept ZapDesk's credentials. Reconnect GitHub from the project page, or replace an expired or revoked GITHUB_TOKEN.";
  }
  if (status === 403) {
    return isWrite
      ? 'ZapDesk cannot write to this repository. Its GitHub App installation, or GITHUB_TOKEN, needs Issues: Read & write.'
      : 'ZapDesk cannot read this repository. Add it to the GitHub App installation, or give GITHUB_TOKEN Issues: Read access to it.';
  }
  if (status === 404) {
    return 'That issue no longer exists, or ZapDesk cannot see it.';
  }
  if (status === 410) {
    return 'Issues are turned off for this repository.';
  }
  if (status === 422) {
    return 'GitHub refused the change. A label or assignee in it may not exist on this repository.';
  }
  return `GitHub returned ${status} for ${path}`;
}

/** A comment on a GitHub issue, as the ticket screens show one. */
export interface GitHubIssueComment {
  id: number;
  authorLogin: string;
  authorName: string;
  avatarUrl?: string;
  /** Sanitised HTML, GitHub's own rendering of the Markdown. */
  html: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface GitHubIssueDetail {
  issue: GitHubIssue;
  /** Sanitised HTML of the issue body, empty when it has none. */
  descriptionHtml: string;
  comments: GitHubIssueComment[];
}

function toComment(comment: GitHubComment): GitHubIssueComment {
  return {
    id: comment.id,
    authorLogin: comment.user?.login ?? 'unknown',
    authorName: comment.user?.name || comment.user?.login || 'Unknown',
    avatarUrl: comment.user?.avatar_url,
    html: renderBody(comment.body_html, comment.body),
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
    url: comment.html_url,
  };
}

/**
 * The HTML to show for a body.
 *
 * GitHub's rendering when there is one. Failing that the raw Markdown as text,
 * escaped into a paragraph: unrendered Markdown is still readable, and putting
 * the raw string into the page as markup would not be.
 */
function renderBody(html: string | null | undefined, raw: string | null | undefined): string {
  if (html) return sanitizeEmailHtml(html);
  if (!raw?.trim()) return '';
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<p style="white-space: pre-wrap;">${escaped}</p>`;
}

/** One issue with its body and its comments. `repo` is `owner/name`. */
export async function fetchIssueDetail(
  repo: string,
  number: number,
  token: string
): Promise<GitHubIssueDetail> {
  const [issueResponse, commentsResponse] = await Promise.all([
    gitHub(`/repos/${repo}/issues/${number}`, token, { accept: HTML_ACCEPT }),
    gitHub(`/repos/${repo}/issues/${number}/comments?per_page=${MAX_COMMENTS}`, token, {
      accept: HTML_ACCEPT,
    }),
  ]);

  const issue = (await issueResponse.json()) as IssueWithHtml;
  const comments = (await commentsResponse.json()) as GitHubComment[];

  return {
    issue,
    descriptionHtml: renderBody(issue.body_html, issue.body),
    comments: (Array.isArray(comments) ? comments : []).map(toComment),
  };
}

/** Add a comment, and return it as the screen will show it. */
export async function addIssueComment(
  repo: string,
  number: number,
  token: string,
  body: string
): Promise<GitHubIssueComment> {
  const response = await gitHub(`/repos/${repo}/issues/${number}/comments`, token, {
    method: 'POST',
    accept: HTML_ACCEPT,
    body: JSON.stringify({ body }),
  });
  return toComment((await response.json()) as GitHubComment);
}

export interface IssueEdit {
  title?: string;
  /** GitHub logins. An empty array clears the assignees. */
  assignees?: string[];
}

/** Edit an issue's own fields. */
export async function updateIssue(
  repo: string,
  number: number,
  token: string,
  edit: IssueEdit
): Promise<GitHubIssue> {
  const response = await gitHub(`/repos/${repo}/issues/${number}`, token, {
    method: 'PATCH',
    body: JSON.stringify(edit),
  });
  return (await response.json()) as GitHubIssue;
}

/**
 * Put an issue into a ZapDesk status.
 *
 * Two calls, because GitHub keeps the state and the labels apart. The labels
 * go first: if the state write then fails the issue is mislabelled but still
 * open, which is recoverable, where a closed issue still labelled "in
 * progress" reads as a bug in the board.
 *
 * `currentLabels` are the issue's labels now, so the repository's own --
 * `bug`, `ticket`, a component name -- survive the write.
 */
export async function setIssueStatus(
  repo: string,
  number: number,
  token: string,
  status: TicketStatus,
  currentLabels: readonly string[]
): Promise<GitHubIssue> {
  const write = gitHubWriteForStatus(status);
  const labels = gitHubLabelsAfterStatus(currentLabels, status);

  await gitHub(`/repos/${repo}/issues/${number}/labels`, token, {
    method: 'PUT',
    body: JSON.stringify({ labels }),
  });

  const response = await gitHub(`/repos/${repo}/issues/${number}`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      state: write.state,
      // GitHub rejects a reason on an issue being opened.
      ...(write.stateReason ? { state_reason: write.stateReason } : {}),
    }),
  });

  return (await response.json()) as GitHubIssue;
}

/**
 * Split `owner/repo#123` back into its parts, or null when it is not one.
 *
 * The reference is what the board carries on a GitHub card, and it arrives
 * here from a query string, so it is checked rather than trusted: anything
 * else would be interpolated straight into a GitHub API path.
 */
export function parseIssueRef(ref: string): { repo: string; number: number } | null {
  const match = /^([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)#(\d+)$/.exec(ref.trim());
  if (!match) return null;
  const number = Number(match[2]);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return { repo: match[1], number };
}
