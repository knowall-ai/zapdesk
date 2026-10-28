import { NextRequest, NextResponse } from 'next/server';
import { getServerSessionWithToken } from '@/lib/server-session';
import {
  getInstallation,
  gitHubAppConfig,
  userCanAccessInstallation,
  verifyConnectState,
  writeProjectInstallation,
} from '@/lib/github-app';
import { appBaseUrl } from '@/lib/install';

/**
 * GET /api/github/setup - Where GitHub sends the admin after they install the
 * ZapDesk GitHub App (#457). This is the App's callback URL, with "Request
 * user authorization (OAuth) during installation" on, so GitHub adds a code.
 *
 * Before the installation is linked to the project:
 * - the signed state must be ours, unexpired, and started by this user;
 * - the code must belong to a GitHub user who can reach the installation, so
 *   a pasted installation id of another company is useless;
 * - Azure DevOps must accept the write with the user's own token, so only
 *   someone who may edit the project can link it.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const session = await getServerSessionWithToken();
  if (!session?.accessToken || !session.user?.id) {
    return NextResponse.redirect(`${appBaseUrl()}/login`);
  }

  const state = verifyConnectState(params.get('state'));
  if (!state || state.user !== session.user.id) {
    // GitHub also comes here when an installation is changed on github.com,
    // without our state; there is nothing to link then.
    return NextResponse.redirect(`${appBaseUrl()}/projects?github=expired`);
  }

  const back = (result: string) =>
    NextResponse.redirect(
      `${appBaseUrl()}/projects/${encodeURIComponent(state.projectId)}?github=${result}`
    );

  const config = gitHubAppConfig();
  if (!config) return back('unavailable');

  // An org member without rights asked their GitHub admin to approve it
  if (params.get('setup_action') === 'request') return back('requested');

  const installationId = Number(params.get('installation_id'));
  const code = params.get('code');
  if (!Number.isInteger(installationId) || installationId <= 0 || !code) return back('failed');

  try {
    if (!(await userCanAccessInstallation(config, code, installationId))) {
      console.warn(
        `[GitHub App] ${session.user.id} tried to link installation ${installationId} they cannot access`
      );
      return back('forbidden');
    }

    const installation = await getInstallation(config, installationId);
    if (!installation) return back('failed');

    await writeProjectInstallation(state.org, state.projectId, session.accessToken, {
      installationId,
      account: installation.account,
    });
    return back('connected');
  } catch (error) {
    console.error('[GitHub App] Could not connect the installation:', error);
    const status = (error as { status?: number }).status;
    return back(status === 401 || status === 403 ? 'forbidden' : 'failed');
  }
}
