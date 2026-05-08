import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';
import { isEmailTicket, extractRequesterEmail, sendAgentReply } from '@/lib/email';

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

    // Get all projects to find the work item
    const projects = await devopsService.getProjects();

    for (const project of projects) {
      try {
        const workItem = await devopsService.getWorkItem(project.name, ticketId);
        if (workItem) {
          const comments = await devopsService.getWorkItemComments(project.name, ticketId);
          return NextResponse.json({ comments });
        }
      } catch {
        // Ticket not in this project, continue
        continue;
      }
    }

    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  } catch (error) {
    console.error('Error fetching comments:', error);
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
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

    const organization = request.headers.get('x-devops-org') || undefined;
    const devopsService = new AzureDevOpsService(session.accessToken, organization);

    // Get all projects to find the ticket
    const projects = await devopsService.getProjects();

    for (const project of projects) {
      try {
        const workItem = await devopsService.getWorkItem(project.name, ticketId);
        if (workItem) {
          // Add internal note prefix if needed
          const commentText = isInternal ? `[Internal Note] ${comment}` : comment;

          // For email-tagged tickets, snapshot the prior conversation BEFORE
          // adding the new comment so the agent's reply email shows everything
          // up to (but not including) the message we're about to send.
          // Order: newest comment first, original ticket description at the
          // bottom — matches how email clients display threaded replies.
          let priorHistory: Array<{
            authorName: string;
            createdAt: Date;
            contentHtml: string;
          }> = [];
          const tags = workItem.fields?.['System.Tags'] || '';
          const isEmail = !isInternal && isEmailTicket(tags);
          if (isEmail) {
            try {
              const existing = await devopsService.getWorkItemComments(project.name, ticketId);
              priorHistory = existing
                .filter((c) => !c.content.includes('[Internal Note]'))
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .map((c) => ({
                  authorName: c.author.displayName || 'Unknown',
                  createdAt: c.createdAt,
                  contentHtml: c.content,
                }));

              // Append the original ticket description (the customer's first
              // email) as the final entry. Use the requester from the
              // email-from tag as author and the ticket's CreatedDate so the
              // entry is rendered consistently with the rest.
              const description = String(workItem.fields?.['System.Description'] || '');
              const createdDateRaw = workItem.fields?.['System.CreatedDate'];
              if (description) {
                const requesterFromTag = extractRequesterEmail(tags);
                priorHistory.push({
                  authorName: requesterFromTag || 'Customer',
                  createdAt: createdDateRaw ? new Date(String(createdDateRaw)) : new Date(0),
                  contentHtml: description,
                });
              }
            } catch (err) {
              // History fetch is best-effort — don't block the comment on it.
              console.warn(`Failed to fetch comment history for ticket #${ticketId}:`, err);
            }
          }

          await devopsService.addComment(project.name, ticketId, commentText);

          if (isEmail) {
            const requesterEmail = extractRequesterEmail(tags);
            if (requesterEmail) {
              const subject = workItem.fields?.['System.Title'] || 'Your ticket';
              const agentName = session.user?.name || 'Support Agent';
              // Fire-and-forget — never block the response on outbound mail.
              sendAgentReply(
                ticketId,
                subject,
                requesterEmail,
                agentName,
                comment,
                undefined,
                priorHistory
              ).catch(() => {});
            }
          }

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
