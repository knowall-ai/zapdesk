import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const { comment, isInternal } = body;

    if (!comment) {
      return NextResponse.json({ error: 'Comment is required' }, { status: 400 });
    }

    const devopsService = new AzureDevOpsService(session.accessToken);

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
