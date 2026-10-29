import { NextRequest, NextResponse } from 'next/server';
import { getServerSessionWithToken } from '@/lib/server-session';
import { validateOrganizationAccess } from '@/lib/devops-auth';
import {
  canManageProject,
  gitHubAppConfig,
  readProjectInstallation,
  writeProjectInstallation,
} from '@/lib/github-app';

/**
 * /api/github/connection?project=<project id> - A DevOps project's GitHub
 * connection (#457), for the organization in `x-devops-org`.
 *
 * GET: whether the App is available, what is connected, and whether this user
 * may change it. DELETE: disconnect (Azure DevOps checks the user may).
 */

async function context(request: NextRequest) {
  const session = await getServerSessionWithToken();
  if (!session?.accessToken) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const org = request.headers.get('x-devops-org') || '';
  const projectId = request.nextUrl.searchParams.get('project') || '';
  if (!org || !projectId) {
    return {
      error: NextResponse.json({ error: 'Organization and project are required' }, { status: 400 }),
    };
  }
  if (!(await validateOrganizationAccess(session.accessToken, org))) {
    return {
      error: NextResponse.json(
        { error: 'Access denied to the specified organization' },
        { status: 403 }
      ),
    };
  }
  return { accessToken: session.accessToken, org, projectId };
}

export async function GET(request: NextRequest) {
  const ctx = await context(request);
  if ('error' in ctx) return ctx.error;

  if (!gitHubAppConfig()) {
    return NextResponse.json({ app: false, connection: null, canManage: false });
  }

  try {
    const [connection, canManage] = await Promise.all([
      readProjectInstallation(ctx.org, ctx.projectId, ctx.accessToken),
      canManageProject(ctx.org, ctx.projectId, ctx.accessToken),
    ]);
    return NextResponse.json({ app: true, connection, canManage });
  } catch (error) {
    console.error('[GitHub App] Could not read the project connection:', error);
    return NextResponse.json({ error: 'Could not read the GitHub connection' }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = await context(request);
  if ('error' in ctx) return ctx.error;

  try {
    await writeProjectInstallation(ctx.org, ctx.projectId, ctx.accessToken, null);
    return NextResponse.json({ success: true });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 403) {
      return NextResponse.json(
        { error: 'Only someone who can edit this project can disconnect GitHub' },
        { status: 403 }
      );
    }
    console.error('[GitHub App] Could not disconnect:', error);
    return NextResponse.json({ error: 'Could not disconnect GitHub' }, { status: 502 });
  }
}
