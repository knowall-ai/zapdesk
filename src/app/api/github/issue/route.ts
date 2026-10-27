import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { resolveIssueAccess } from '@/lib/github-issue-access';
import {
  fetchIssueDetail,
  setIssueStatus,
  updateIssue,
  type IssueEdit,
} from '@/lib/github-issue-detail';
import { GitHubApiError, gitHubIssueToTicket } from '@/lib/github-issues';
import type { TicketStatus } from '@/types';

/**
 * One GitHub issue, for the ZapDesk detail pop-up (#566).
 *
 * Until now a GitHub card on the Kanban board opened github.com, so an issue
 * was the one thing on the board you had to leave ZapDesk to work on.
 *
 * `?ref=owner/repo%23123`. Access is decided by the mapping, not by GitHub:
 * see `github-issue-access`.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await resolveIssueAccess(
    request.nextUrl.searchParams.get('ref'),
    request.headers.get('x-devops-org'),
    session.accessToken
  );
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const detail = await fetchIssueDetail(access.repo, access.number, access.token);
    return NextResponse.json({
      ticket: { ...access.ticket, description: detail.descriptionHtml },
      comments: detail.comments,
      issueUrl: detail.issue.html_url,
    });
  } catch (error) {
    return failure(error, 'read');
  }
}

const STATUSES: readonly TicketStatus[] = [
  'New',
  'Open',
  'In Progress',
  'Pending',
  'Resolved',
  'Closed',
];

/**
 * Change an issue from the pop-up: its status, its title or its assignee.
 *
 * The status goes through the GitHub process template (#567), so it becomes a
 * state and a label rather than only open or closed.
 */
export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { ref?: string; status?: string; title?: string; assignees?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const access = await resolveIssueAccess(
    body.ref ?? null,
    request.headers.get('x-devops-org'),
    session.accessToken
  );
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const edit: IssueEdit = {};
  if (body.title !== undefined) {
    const title = String(body.title).trim();
    if (!title) {
      return NextResponse.json({ error: 'A title is required.' }, { status: 400 });
    }
    edit.title = title;
  }
  if (body.assignees !== undefined) {
    if (!Array.isArray(body.assignees) || body.assignees.some((a) => typeof a !== 'string')) {
      return NextResponse.json({ error: 'Assignees must be GitHub usernames.' }, { status: 400 });
    }
    edit.assignees = body.assignees;
  }

  if (body.status !== undefined && !STATUSES.includes(body.status as TicketStatus)) {
    return NextResponse.json(
      { error: `Status must be one of: ${STATUSES.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    if (Object.keys(edit).length > 0) {
      await updateIssue(access.repo, access.number, access.token, edit);
    }

    // After the edit, so a title change and a status change in one request do
    // not race each other onto the same issue.
    const issue = body.status
      ? await setIssueStatus(
          access.repo,
          access.number,
          access.token,
          body.status as TicketStatus,
          access.ticket.tags ?? []
        )
      : null;

    return NextResponse.json({
      success: true,
      ...(issue
        ? {
            ticket: gitHubIssueToTicket(
              issue,
              access.repo,
              access.ticket.project,
              access.ticket.organization
            ),
          }
        : {}),
    });
  } catch (error) {
    return failure(error, 'write');
  }
}

/**
 * Answer a GitHub failure in words the user can act on, keeping its status
 * where that is something they can do something about.
 *
 * A write refused for want of permission is the one that most needs saying
 * out loud: without it, "nothing happened" looks like a bug in ZapDesk rather
 * than a GitHub App that was never granted Issues: Read & write.
 */
function failure(error: unknown, what: 'read' | 'write'): NextResponse {
  if (error instanceof GitHubApiError) {
    console.error(`[GitHub] issue ${what} failed (${error.status}):`, error.message);
    const status = [401, 403, 404, 410, 422].includes(error.status) ? error.status : 502;
    return NextResponse.json({ error: error.message }, { status });
  }
  console.error(`[GitHub] issue ${what} failed:`, error);
  return NextResponse.json({ error: `Failed to ${what} the GitHub issue` }, { status: 500 });
}
