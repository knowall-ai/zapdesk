import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ project: string; type: string; fieldRef: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawParams = await params;
    const project = decodeURIComponent(rawParams.project);
    const type = decodeURIComponent(rawParams.type);
    const fieldRef = decodeURIComponent(rawParams.fieldRef);
    const organization = request.headers.get('x-devops-org') || undefined;
    const devopsService = new AzureDevOpsService(session.accessToken, organization);

    const fieldData = await devopsService.getWorkItemTypeField(project, type, fieldRef);

    return NextResponse.json(fieldData);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch field info';
    console.error('Error fetching field info:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
