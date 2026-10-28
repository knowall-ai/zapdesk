import { NextRequest, NextResponse } from 'next/server';
import { getServerSessionWithToken } from '@/lib/server-session';
import { validateOrganizationAccess } from '@/lib/devops-auth';
import { canManageProject, gitHubAppConfig, installUrl, signConnectState } from '@/lib/github-app';
import { appBaseUrl } from '@/lib/install';

/**
 * GET /api/github/connect?org=<devops org>&project=<project id> - Start
 * connecting a DevOps project to GitHub (#457).
 *
 * Only someone who may edit the project gets the link. The state names the
 * organization, project and user, and is signed, so the setup callback can
 * trust where the installation is meant to go.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSessionWithToken();
  if (!session?.accessToken || !session.user?.id) {
    return NextResponse.redirect(`${appBaseUrl()}/login`);
  }

  const org = request.nextUrl.searchParams.get('org') || '';
  const projectId = request.nextUrl.searchParams.get('project') || '';
  const back = (reason: string) =>
    NextResponse.redirect(
      `${appBaseUrl()}/projects/${encodeURIComponent(projectId)}?github=${reason}`
    );

  const config = gitHubAppConfig();
  if (!config) return back('unavailable');
  if (!org || !projectId) {
    return NextResponse.json({ error: 'org and project are required' }, { status: 400 });
  }

  if (!(await validateOrganizationAccess(session.accessToken, org))) return back('forbidden');
  if (!(await canManageProject(org, projectId, session.accessToken))) return back('forbidden');

  const state = signConnectState({ org, projectId, user: session.user.id });
  return NextResponse.redirect(installUrl(config, state));
}
