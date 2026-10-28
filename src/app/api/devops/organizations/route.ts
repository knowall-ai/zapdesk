import { NextRequest, NextResponse } from 'next/server';
import { getServerSessionWithToken } from '@/lib/server-session';
import { AzureDevOpsService, parseEmailDomainsFromDescription } from '@/lib/devops';
import { parseSLAFromDescription } from '@/lib/sla';
import { requestDevOpsOrg } from '@/lib/devops-org';
import type { Organization } from '@/types';

// A project's email domain and SLA level come from its description in Azure
// DevOps ("Email: example.com", "SLA: Gold"), the same lines email routing and
// the SLA reports read, so no customer has to be named in this code (#457).

/** The SLA level named in a project description, as the lower-case tag the UI reads. */
function slaTags(description?: string): string[] {
  const level = parseSLAFromDescription(description || '');
  return level ? [level.toLowerCase()] : [];
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSessionWithToken();

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const devopsService = new AzureDevOpsService(session.accessToken, requestDevOpsOrg(request));
    const projects = await devopsService.getProjects();

    const organizations: Organization[] = projects.map(
      (project: {
        id: string;
        name: string;
        description?: string;
        lastUpdateTime?: string;
        revision?: number;
      }) => ({
        id: project.id,
        name: project.name,
        domain: parseEmailDomainsFromDescription(project.description || '')[0],
        devOpsProject: project.name,
        devOpsOrg: devopsService.organizationName,
        tags: slaTags(project.description),
        createdAt: project.lastUpdateTime ? new Date(project.lastUpdateTime) : new Date(),
        updatedAt: project.lastUpdateTime ? new Date(project.lastUpdateTime) : new Date(),
      })
    );

    return NextResponse.json({ organizations });
  } catch (error) {
    console.error('Error fetching organizations:', error);
    return NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 });
  }
}
