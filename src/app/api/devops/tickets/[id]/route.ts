import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService, workItemToTicket } from '@/lib/devops';

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
    const found = await devopsService.findProjectForWorkItem(ticketId);

    if (!found) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const ticket = workItemToTicket(found.workItem, {
      id: found.project.id,
      name: found.project.name,
      devOpsProject: found.project.name,
      devOpsOrg: 'KnowAll',
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const comments = await devopsService.getWorkItemComments(found.project.name, ticketId);
    const attachments = await devopsService.getWorkItemAttachments(found.project.name, ticketId);

    return NextResponse.json({
      ticket: { ...ticket, attachments },
      comments,
    });
  } catch (error) {
    console.error('Error fetching ticket:', error);
    return NextResponse.json({ error: 'Failed to fetch ticket' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
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
    const { assignee, assignToMe, priority, project, title, description } = body;

    const organization = request.headers.get('x-devops-org') || undefined;
    const devopsService = new AzureDevOpsService(session.accessToken, organization);

    // If no project provided, find it by searching all projects
    let projectName = project;
    if (!projectName) {
      const found = await devopsService.findProjectForWorkItem(ticketId);
      if (!found) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
      }
      projectName = found.project.name;
    }

    // Build updates object
    const updates: {
      assignee?: string | null;
      priority?: number;
      title?: string;
      description?: string;
    } = {};

    if (assignToMe) {
      // Use the Azure DevOps profile API to get the authenticated user's identity
      // Format as "Display Name <email>" to avoid ambiguous identity errors
      const profile = await devopsService.getUserProfile();
      updates.assignee = `${profile.displayName} <${profile.emailAddress}>`;
    } else if (assignee !== undefined) {
      updates.assignee = assignee; // Can be null to unassign
    }

    if (priority !== undefined) {
      updates.priority = priority;
    }

    if (title !== undefined) {
      updates.title = title;
    }

    if (description !== undefined) {
      updates.description = description;
    }

    // Update the work item
    const updatedWorkItem = await devopsService.updateTicketFields(projectName, ticketId, updates);

    const ticket = workItemToTicket(updatedWorkItem, {
      id: projectName,
      name: projectName,
      devOpsProject: projectName,
      devOpsOrg: 'KnowAll',
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return NextResponse.json({ ticket });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update ticket';
    console.error('Error updating ticket:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
