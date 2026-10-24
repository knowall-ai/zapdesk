import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { parseWorkItemId } from '@/lib/work-item-id';
import { AzureDevOpsService } from '@/lib/devops';
import { requestDevOpsOrg } from '@/lib/devops-org';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const ticketId = parseWorkItemId(id);

    if (ticketId === null) {
      return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 });
    }

    const devopsService = new AzureDevOpsService(session.accessToken, requestDevOpsOrg(request));
    const found = await devopsService.findProjectForWorkItem(ticketId);

    if (!found) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const updates = await devopsService.getWorkItemUpdates(found.project.name, ticketId);

    return NextResponse.json({ updates: updates.reverse() });
  } catch (error) {
    console.error('Error fetching ticket history:', error);
    return NextResponse.json({ error: 'Failed to fetch ticket history' }, { status: 500 });
  }
}
