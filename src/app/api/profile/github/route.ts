import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, getGraphToken } from '@/lib/auth';
import { getGitHubUsername, listLinkedGitHubAccounts, saveGitHubUsername } from '@/lib/graph';
import { clearLinkedAccountsCache, normalizeGitHubLogin } from '@/lib/github-issues';

/**
 * The signed-in user's GitHub username, kept on their Microsoft profile next
 * to their Lightning Address (#455). GitHub issues assigned to or opened by
 * that username are then listed under this person instead of as a second one.
 */

/**
 * GET /api/profile/github - Get the current user's GitHub username
 */
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Approved organisations only (src/lib/tenant-approval.ts)
  if (session.tenantApproved === false) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const graphToken = await getGraphToken(session.tenantId);
  if (!graphToken) {
    return NextResponse.json({ error: 'Failed to get Graph token' }, { status: 500 });
  }

  const githubUsername = await getGitHubUsername(graphToken, session.user.email);

  return NextResponse.json({ githubUsername });
}

/**
 * POST /api/profile/github - Save the current user's GitHub username
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Approved organisations only (src/lib/tenant-approval.ts)
  if (session.tenantApproved === false) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const raw: unknown = body?.githubUsername;
  const githubUsername = typeof raw === 'string' ? normalizeGitHubLogin(raw) : null;

  if (!githubUsername) {
    return NextResponse.json(
      {
        error: 'Enter a GitHub username: letters, digits and single hyphens, up to 39 characters',
      },
      { status: 400 }
    );
  }

  const graphToken = await getGraphToken(session.tenantId);
  if (!graphToken) {
    return NextResponse.json({ error: 'Failed to get Graph token' }, { status: 500 });
  }

  // One username, one person: otherwise anyone could have someone else's
  // issues listed under their own name. The check must see every user, so a
  // save is refused when it cannot.
  const me = session.user.email.toLowerCase();
  try {
    const accounts = await listLinkedGitHubAccounts(graphToken, { requireComplete: true });
    const claimedByOther = accounts.some(
      (account) =>
        account.login.toLowerCase() === githubUsername.toLowerCase() &&
        account.userPrincipalName.toLowerCase() !== me &&
        account.email.toLowerCase() !== me
    );
    if (claimedByOther) {
      return NextResponse.json(
        { error: `GitHub username ${githubUsername} is already linked to another person` },
        { status: 409 }
      );
    }
  } catch (error) {
    console.error('Could not check whether the GitHub username is taken:', error);
    return NextResponse.json(
      { error: 'Could not check whether this GitHub username is already linked; try again later' },
      { status: 503 }
    );
  }

  const success = await saveGitHubUsername(graphToken, session.user.email, githubUsername);

  if (!success) {
    return NextResponse.json({ error: 'Failed to save GitHub username' }, { status: 500 });
  }

  clearLinkedAccountsCache(session.tenantId || '');
  return NextResponse.json({ success: true, githubUsername });
}

/**
 * DELETE /api/profile/github - Remove the current user's GitHub username
 */
export async function DELETE() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Approved organisations only (src/lib/tenant-approval.ts)
  if (session.tenantApproved === false) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const graphToken = await getGraphToken(session.tenantId);
  if (!graphToken) {
    return NextResponse.json({ error: 'Failed to get Graph token' }, { status: 500 });
  }

  const success = await saveGitHubUsername(graphToken, session.user.email, null);

  if (!success) {
    return NextResponse.json({ error: 'Failed to remove GitHub username' }, { status: 500 });
  }

  clearLinkedAccountsCache(session.tenantId || '');
  return NextResponse.json({ success: true });
}
