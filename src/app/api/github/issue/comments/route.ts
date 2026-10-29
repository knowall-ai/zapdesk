import { NextRequest, NextResponse } from 'next/server';
import { getServerSessionWithToken } from '@/lib/server-session';
import { resolveIssueAccess } from '@/lib/github-issue-access';
import { addIssueComment } from '@/lib/github-issue-detail';
import { GitHubApiError } from '@/lib/github-issues';

/** How long a single comment may be. GitHub's own limit is 65536 characters. */
const MAX_COMMENT_LENGTH = 65536;

/**
 * Comment on a GitHub issue from the ZapDesk pop-up (#566).
 *
 * The comment is posted with ZapDesk's credential, so it is signed with the
 * author's name: on GitHub it would otherwise read as having come from the
 * app, and a reader there could not tell who on the support team wrote it.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSessionWithToken();
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { ref?: string; comment?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
  if (!comment) {
    return NextResponse.json({ error: 'A comment is required.' }, { status: 400 });
  }
  if (comment.length > MAX_COMMENT_LENGTH) {
    return NextResponse.json(
      { error: `A comment must be ${MAX_COMMENT_LENGTH} characters or fewer.` },
      { status: 400 }
    );
  }

  const access = await resolveIssueAccess(
    body.ref ?? null,
    request.headers.get('x-devops-org'),
    session.accessToken
  );
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const posted = await addIssueComment(
      access.repo,
      access.number,
      access.token,
      signed(comment, session.user?.name, session.user?.email)
    );
    return NextResponse.json({ success: true, comment: posted });
  } catch (error) {
    if (error instanceof GitHubApiError) {
      console.error(`[GitHub] comment failed (${error.status}):`, error.message);
      const status = [401, 403, 404, 410, 422].includes(error.status) ? error.status : 502;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error('[GitHub] comment failed:', error);
    return NextResponse.json({ error: 'Failed to add the comment' }, { status: 500 });
  }
}

/**
 * The comment with its author named underneath.
 *
 * Markdown, because GitHub renders the body as Markdown. The name is escaped
 * so a display name cannot bring its own formatting -- or a link -- into a
 * comment on a public repository.
 */
function signed(comment: string, name?: string | null, email?: string | null): string {
  const author = (name || email || '').trim();
  if (!author) return `${comment}\n\n*via ZapDesk*`;
  return `${comment}\n\n*via ZapDesk, from ${escapeMarkdown(author)}*`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!<>|~]/g, (char) => `\\${char}`);
}
