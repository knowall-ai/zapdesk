import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService, workItemToTicket } from '@/lib/devops';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const body = await request.json();
    const { state } = body;

    if (!state) {
      return NextResponse.json({ error: 'State is required' }, { status: 400 });
    }

    const organization = request.headers.get('x-devops-org') || undefined;
    const devopsService = new AzureDevOpsService(session.accessToken, organization);

    console.log('[state PATCH] incoming', {
      ticketId,
      state,
      project: body.project,
      organization,
    });

    // If project is provided in the body, use it directly
    if (body.project) {
      try {
        const updatedWorkItem = await devopsService.updateTicketState(
          body.project,
          ticketId,
          state
        );
        console.log('[state PATCH] success', { ticketId, state, project: body.project });
        const ticket = workItemToTicket(updatedWorkItem);
        return NextResponse.json({ ticket });
      } catch (err) {
        console.error('[state PATCH] DevOps rejected update', {
          ticketId,
          state,
          project: body.project,
          error: err instanceof Error ? err.message : err,
        });
        const message = err instanceof Error ? err.message : 'Failed to update ticket state';
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    // Fallback: search all projects to find the ticket
    const projects = await devopsService.getProjects();

    for (const project of projects) {
      try {
        const workItem = await devopsService.getWorkItem(project.name, ticketId);
        if (workItem) {
          try {
            const updatedWorkItem = await devopsService.updateTicketState(
              project.name,
              ticketId,
              state
            );
            console.log('[state PATCH] success (fallback project lookup)', {
              ticketId,
              state,
              project: project.name,
            });

            const ticket = workItemToTicket(updatedWorkItem, {
              id: project.id,
              name: project.name,
              devOpsProject: project.name,
              devOpsOrg: organization || '',
              tags: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            return NextResponse.json({ ticket });
          } catch (err) {
            console.error('[state PATCH] DevOps rejected update (fallback)', {
              ticketId,
              state,
              project: project.name,
              error: err instanceof Error ? err.message : err,
            });
            const message = err instanceof Error ? err.message : 'Failed to update ticket state';
            return NextResponse.json({ error: message }, { status: 400 });
          }
        }
      } catch {
        // Ticket not in this project, continue
        continue;
      }
    }

    console.warn('[state PATCH] ticket not found in any project', { ticketId });
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  } catch (error) {
    console.error('[state PATCH] unexpected error', error);
    return NextResponse.json({ error: 'Failed to update ticket state' }, { status: 500 });
  }
}
