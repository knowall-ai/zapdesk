import { NextRequest, NextResponse } from 'next/server';
import { AzureDevOpsService, workItemToTicket, mapStatusToState } from '@/lib/devops';
import { requirePermission, isAuthed } from '@/lib/api-auth';
import type { TicketStatus } from '@/types';

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
    const { status } = body;

    if (!status) {
      return NextResponse.json({ error: 'Status is required' }, { status: 400 });
    }

    // Map frontend status to Azure DevOps state
    const devOpsState = mapStatusToState(status as TicketStatus);

    const devopsService = new AzureDevOpsService(session.accessToken!);

    // Get all projects to find the ticket
    const projects = await devopsService.getProjects();

    for (const project of projects) {
      try {
        const workItem = await devopsService.getWorkItem(project.name, ticketId);
        if (workItem) {
          const updatedWorkItem = await devopsService.updateTicketState(
            project.name,
            ticketId,
            devOpsState
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
    console.error('Error updating ticket status:', error);
    return NextResponse.json({ error: 'Failed to update ticket status' }, { status: 500 });
  }
}
