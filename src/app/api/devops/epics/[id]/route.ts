import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';
import { validateOrganizationAccess } from '@/lib/devops-auth';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get organization from header (client sends from localStorage selection)
    const devOpsOrg = request.headers.get('x-devops-org');

    if (!devOpsOrg) {
      return NextResponse.json({ error: 'No organization specified' }, { status: 400 });
    }

    // Validate user has access to the requested organization
    const hasAccess = await validateOrganizationAccess(session.accessToken, devOpsOrg);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Access denied to the specified organization' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const epicId = parseInt(id, 10);

    if (isNaN(epicId)) {
      return NextResponse.json({ error: 'Invalid epic ID' }, { status: 400 });
    }

    const searchParams = request.nextUrl.searchParams;
    const project = searchParams.get('project');

    if (!project) {
      return NextResponse.json({ error: 'Project parameter is required' }, { status: 400 });
    }

    const devOpsService = new AzureDevOpsService(session.accessToken, devOpsOrg);
    const epic = await devOpsService.getEpicHierarchy(project, epicId);
    const treemapData = devOpsService.epicToTreemap(epic);

    return NextResponse.json({
      epic,
      treemapData,
    });
  } catch (error) {
    console.error('Error fetching epic hierarchy:', error);
    return NextResponse.json({ error: 'Failed to fetch epic hierarchy' }, { status: 500 });
  }
}
