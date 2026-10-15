import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { validateOrganizationAccess } from '@/lib/devops-auth';
import { AzureDevOpsService } from '@/lib/devops';
import { gitHubIssuesConfig, getGitHubTickets } from '@/lib/github-issues';
import { gitHubPeopleFor } from '@/lib/github-people';
import { filterTicketsByView } from '@/lib/ticket-views';

/**
 * GitHub issues as tickets, for the same views as /api/devops/tickets (#447).
 *
 * The issues are read with the server's token, so access is decided here: a
 * user only gets issues mapped to DevOps projects they can see in the selected
 * organization.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = gitHubIssuesConfig();
    if (!config) {
      return NextResponse.json({ configured: false, tickets: [], total: 0, failedRepos: [] });
    }

    const organization = request.headers.get('x-devops-org');
    if (!organization) {
      return NextResponse.json({ error: 'No organization specified' }, { status: 400 });
    }

    const hasAccess = await validateOrganizationAccess(session.accessToken, organization);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Access denied to the specified organization' },
        { status: 403 }
      );
    }

    const devopsService = new AzureDevOpsService(session.accessToken, organization);
    const projects = await devopsService.getProjects();
    // Show mapped and linked GitHub accounts as their DevOps user
    const { devOpsUsers, linkedAccounts } = await gitHubPeopleFor(organization, config, () =>
      devopsService.getOrganizationUsers()
    );
    const { tickets, failedRepos } = await getGitHubTickets(
      projects,
      organization,
      config,
      devOpsUsers,
      linkedAccounts
    );

    const view = request.nextUrl.searchParams.get('view') || 'all-unsolved';
    // GitHub has no Removed state, and the shared filter returns everything for
    // a view it does not know.
    const filtered =
      view === 'removed' ? [] : filterTicketsByView(tickets, view, session.user?.email);

    return NextResponse.json({
      configured: true,
      tickets: filtered,
      total: filtered.length,
      failedRepos,
    });
  } catch (error) {
    console.error('Error fetching GitHub issues:', error);
    return NextResponse.json({ error: 'Failed to fetch GitHub issues' }, { status: 500 });
  }
}
