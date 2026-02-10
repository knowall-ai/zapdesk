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

    // Get all projects to find the ticket
    const projects = await devopsService.getProjects();

    for (const project of projects) {
      try {
        const workItem = await devopsService.getWorkItem(project.name, ticketId);
        if (workItem) {
          const ticket = workItemToTicket(workItem, {
            id: project.id,
            name: project.name,
            devOpsProject: project.name,
            devOpsOrg: 'KnowAll',
            tags: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          const comments = await devopsService.getWorkItemComments(project.name, ticketId);

          return NextResponse.json({
            ticket,
            comments,
          });
        }
      } catch {
        // Ticket not in this project, continue
        continue;
      }
    }

    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
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
    const { assignee, priority, project, title, description } = body;

    if (!project) {
      return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
    }

    const organization = request.headers.get('x-devops-org') || undefined;
    const devopsService = new AzureDevOpsService(session.accessToken, organization);

    // Build updates object
    const updates: {
      assignee?: string | null;
      priority?: number;
      title?: string;
      description?: string;
    } = {};

    if (assignee !== undefined) {
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
    const updatedWorkItem = await devopsService.updateTicketFields(project, ticketId, updates);

    const ticket = workItemToTicket(updatedWorkItem, {
      id: project,
      name: project,
      devOpsProject: project,
      devOpsOrg: 'KnowAll',
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return NextResponse.json({ ticket });
  } catch (error) {
    console.error('Error updating ticket:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update ticket' },
      { status: 500 }
    );
  }
}
