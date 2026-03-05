import { NextRequest, NextResponse } from 'next/server';
import { AzureDevOpsService } from '@/lib/devops';
import { requirePermission, isAuthed } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await requirePermission('projects:view');
    if (!isAuthed(auth)) return auth;
    const { session } = auth;

    const searchParams = request.nextUrl.searchParams;
    const project = searchParams.get('project');

    if (!project) {
      return NextResponse.json({ error: 'Project parameter is required' }, { status: 400 });
    }

    const devOpsService = new AzureDevOpsService(session.accessToken!);
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
