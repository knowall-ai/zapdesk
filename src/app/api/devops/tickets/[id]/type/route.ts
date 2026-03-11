import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService, workItemToTicket } from '@/lib/devops';
import { validateOrganizationAccess } from '@/lib/devops-auth';

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
    const { type, project } = body;

    if (!type) {
      return NextResponse.json({ error: 'Type is required' }, { status: 400 });
    }

    const organization = request.headers.get('x-devops-org');
    if (!organization) {
      return NextResponse.json({ error: 'No organization specified' }, { status: 400 });
    }

    const hasAccess = await validateOrganizationAccess(session.accessToken, organization);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Access denied to the specified organization' },
        { status: 403 }
      );
    }

    const devopsService = new AzureDevOpsService(session.accessToken, organization);

    // If project is provided, use it directly
    if (project) {
      const updatedWorkItem = await devopsService.changeWorkItemType(project, ticketId, type);
      const ticket = workItemToTicket(updatedWorkItem);
      return NextResponse.json({ ticket });
    }

    // Fallback: find the project
    const found = await devopsService.findProjectForWorkItem(ticketId);
    if (!found) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const updatedWorkItem = await devopsService.changeWorkItemType(
      found.project.name,
      ticketId,
      type
    );
    const ticket = workItemToTicket(updatedWorkItem);
    return NextResponse.json({ ticket });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to change work item type';
    console.error('Error changing work item type:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
