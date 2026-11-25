import { NextRequest, NextResponse } from 'next/server';
import { getServerSessionWithToken } from '@/lib/server-session';
import { AzureDevOpsService, DevOpsApiError } from '@/lib/devops';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ project: string; type: string; fieldRef: string }> }
) {
  try {
    const session = await getServerSessionWithToken();
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
    // A type without the field is an answer, not a failure: the details panel
    // asks this of every type it shows, to see whether it has approval fields.
    if (error instanceof DevOpsApiError && error.status === 404) {
      return NextResponse.json({ error: 'Field not found on this type' }, { status: 404 });
    }
    console.error('Error fetching field info:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
