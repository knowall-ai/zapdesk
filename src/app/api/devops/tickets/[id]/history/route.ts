import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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

    const devopsService = new AzureDevOpsService(session.accessToken);
    const result = await devopsService.findProjectForWorkItem(ticketId);

    if (!result) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const updates = await devopsService.getWorkItemUpdates(result.project.name, ticketId);

    return NextResponse.json({ updates });
  } catch (error) {
    console.error('Error fetching work item history:', error);
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
}
