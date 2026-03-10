import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ project: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { project } = await params;
    const organization = request.headers.get('x-devops-org') || undefined;
    const devopsService = new AzureDevOpsService(session.accessToken, organization);

    const areas = await devopsService.getAreas(decodeURIComponent(project));

    return NextResponse.json({ areas });
  } catch (error) {
    console.error('Error fetching areas:', error);
    return NextResponse.json({ error: 'Failed to fetch areas' }, { status: 500 });
  }
}
