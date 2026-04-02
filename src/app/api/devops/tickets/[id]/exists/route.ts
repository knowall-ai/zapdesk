import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const ticketId = parseInt(id, 10);

    if (isNaN(ticketId)) {
      return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 });
    }

    const organization = request.headers.get('x-devops-org') || undefined;
    const devopsService = new AzureDevOpsService(session.accessToken, organization);
    const result = await devopsService.workItemExists(ticketId);

    if (result === 'not_found') {
      return NextResponse.json({ exists: false }, { status: 404 });
    }

    if (result === 'error') {
      return NextResponse.json({ error: 'Upstream error' }, { status: 502 });
    }

    return NextResponse.json({ exists: true });
  } catch (error) {
    console.error('Error checking ticket existence:', error);
    return NextResponse.json({ error: 'Failed to check ticket' }, { status: 500 });
  }
}
