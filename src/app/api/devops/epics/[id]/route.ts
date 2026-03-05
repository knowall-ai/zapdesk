import { NextRequest, NextResponse } from 'next/server';
import { AzureDevOpsService } from '@/lib/devops';
import { requirePermission, isAuthed } from '@/lib/api-auth';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission('projects:view');
    if (!isAuthed(auth)) return auth;
    const { session } = auth;

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

    const devOpsService = new AzureDevOpsService(session.accessToken!);
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
