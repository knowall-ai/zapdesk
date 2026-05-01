import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService, workItemToTicket } from '@/lib/devops';
import { isEmailTicket, extractRequesterEmail, sendStatusChangeNotification } from '@/lib/email';

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

    // If project is provided in the body, use it directly
    if (body.project) {
      // Snapshot old state first so the email shows the transition.
      let oldState: string | undefined;
      try {
        const existing = await devopsService.getWorkItem(body.project, ticketId);
        oldState = existing?.fields?.['System.State'];
      } catch {
        // Continue without old state — the transition message will say "Unknown".
      }

      const updatedWorkItem = await devopsService.updateTicketState(body.project, ticketId, state);
      notifyStateChange(updatedWorkItem, ticketId, oldState || 'Unknown', state);
      const ticket = workItemToTicket(updatedWorkItem);
      return NextResponse.json({ ticket });
    }

    // Fallback: search all projects to find the ticket
    const projects = await devopsService.getProjects();

    for (const project of projects) {
      try {
        const workItem = await devopsService.getWorkItem(project.name, ticketId);
        if (workItem) {
          const oldState = workItem.fields?.['System.State'] || 'Unknown';

          const updatedWorkItem = await devopsService.updateTicketState(
            project.name,
            ticketId,
            state
          );

          notifyStateChange(updatedWorkItem, ticketId, oldState, state);

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

/** Fire-and-forget email notification for state changes on email-created tickets. */
function notifyStateChange(
  workItem: { fields?: Record<string, unknown> },
  ticketId: number,
  oldState: string,
  newState: string
) {
  const tags = String(workItem.fields?.['System.Tags'] || '');
  if (!isEmailTicket(tags)) return;

  const requesterEmail = extractRequesterEmail(tags);
  if (!requesterEmail) return;

  const subject = String(workItem.fields?.['System.Title'] || 'Your ticket');
  sendStatusChangeNotification(ticketId, subject, requesterEmail, oldState, newState).catch(
    () => {}
  );
}
