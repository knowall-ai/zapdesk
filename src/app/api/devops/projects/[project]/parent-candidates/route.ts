import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';
import { validateOrganizationAccess } from '@/lib/devops-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ project: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    const { project } = await params;
    const projectName = decodeURIComponent(project);

    const devopsService = new AzureDevOpsService(session.accessToken, organization);
    const candidates = await devopsService.getPotentialParents(projectName);

    return NextResponse.json({ candidates });
  } catch (error) {
    console.error('Error fetching parent candidates:', error);
    return NextResponse.json({ error: 'Failed to fetch parent candidates' }, { status: 500 });
  }
}
