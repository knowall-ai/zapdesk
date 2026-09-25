import { NextRequest, NextResponse } from 'next/server';
import { AzureDevOpsService } from '@/lib/devops';
import { requirePermission, isAuthed } from '@/lib/api-auth';
import { validateOrganizationAccess } from '@/lib/devops-auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await requirePermission('projects:view');
    if (!isAuthed(auth)) return auth;
    const { session } = auth;

    // Get organization from header (client sends from localStorage selection)
    const devOpsOrg = request.headers.get('x-devops-org');

    if (!devOpsOrg) {
      return NextResponse.json({ error: 'No organization specified' }, { status: 400 });
    }

    // Validate user has access to the requested organization
    const hasAccess = await validateOrganizationAccess(session.accessToken!, devOpsOrg);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Access denied to the specified organization' },
        { status: 403 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const project = searchParams.get('project');

    if (!project) {
      return NextResponse.json({ error: 'Project parameter is required' }, { status: 400 });
    }

    const devOpsService = new AzureDevOpsService(session.accessToken!, devOpsOrg);
    const epics = await devOpsService.getEpics(project);

    return NextResponse.json({
      epics,
      total: epics.length,
    });
  } catch (error) {
    console.error('Error fetching epics:', error);
    return NextResponse.json({ error: 'Failed to fetch epics' }, { status: 500 });
  }
}
