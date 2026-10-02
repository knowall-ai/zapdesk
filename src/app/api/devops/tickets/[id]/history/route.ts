import { NextRequest, NextResponse } from 'next/server';
import { AzureDevOpsService } from '@/lib/devops';
import { requireAnyPermission, isAuthed } from '@/lib/api-auth';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAnyPermission(['tickets:view_all', 'tickets:view_own']);
    if (!isAuthed(auth)) return auth;
    const { session } = auth;

    const { id } = await params;
    const ticketId = parseInt(id, 10);

    if (isNaN(ticketId)) {
      return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 });
    }

    const devopsService = new AzureDevOpsService(session.accessToken!);
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
