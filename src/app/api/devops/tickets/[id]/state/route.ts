import { NextRequest, NextResponse } from 'next/server';
import { AzureDevOpsService, workItemToTicket } from '@/lib/devops';
import { requirePermission, isAuthed } from '@/lib/api-auth';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission('tickets:change_status');
    if (!isAuthed(auth)) return auth;
    const { session } = auth;

    const { id } = await params;
    const ticketId = parseInt(id, 10);

    if (isNaN(ticketId)) {
      return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 });
    }

    const body = await request.json();
    const { state } = body;

    if (!state) {
      return NextResponse.json({ error: 'State is required' }, { status: 400 });
    }

    const devopsService = new AzureDevOpsService(session.accessToken!);

    // Get all projects to find the ticket
    const projects = await devopsService.getProjects();

    for (const project of projects) {
      try {
        const workItem = await devopsService.getWorkItem(project.name, ticketId);
        if (workItem) {
          // Use the state directly without mapping
          const updatedWorkItem = await devopsService.updateTicketState(
            project.name,
            ticketId,
            state
          );

          const ticket = workItemToTicket(updatedWorkItem, {
            id: project.id,
            name: project.name,
            devOpsProject: project.name,
            devOpsOrg: 'KnowAll',
            tags: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          return NextResponse.json({ ticket });
        }
      } catch {
        // Ticket not in this project, continue
        continue;
      }
    }

    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  } catch (error) {
    console.error('Error updating ticket state:', error);
    return NextResponse.json({ error: 'Failed to update ticket state' }, { status: 500 });
  }
}
