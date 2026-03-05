import { NextRequest, NextResponse } from 'next/server';
import { AzureDevOpsService } from '@/lib/devops';
import { requireAuth, isAuthed } from '@/lib/api-auth';
import { hasPermission } from '@/lib/permissions';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!isAuthed(auth)) return auth;
    const { session, permissions } = auth;

    const { id } = await params;
    const ticketId = parseInt(id, 10);

    if (isNaN(ticketId)) {
      return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 });
    }

    const body = await request.json();
    const { comment, isInternal } = body;

    if (!comment) {
      return NextResponse.json({ error: 'Comment is required' }, { status: 400 });
    }

    // Block internal notes for users without permission
    if (isInternal && !hasPermission(permissions, 'tickets:create_internal_notes')) {
      return NextResponse.json(
        { error: 'You do not have permission to create internal notes' },
        { status: 403 }
      );
    }

    const devopsService = new AzureDevOpsService(session.accessToken!);

    // Get all projects to find the ticket
    const projects = await devopsService.getProjects();

    for (const project of projects) {
      try {
        const workItem = await devopsService.getWorkItem(project.name, ticketId);
        if (workItem) {
          // Add internal note prefix if needed
          const commentText = isInternal ? `[Internal Note] ${comment}` : comment;

          await devopsService.addComment(project.name, ticketId, commentText);

          return NextResponse.json({ success: true });
        }
      } catch {
        // Ticket not in this project, continue
        continue;
      }
    }

    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  } catch (error) {
    console.error('Error adding comment:', error);
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 });
  }
}
