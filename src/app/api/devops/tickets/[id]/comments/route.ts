import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService, claimsEmailOrigin } from '@/lib/devops';
import {
  isEmailTicket,
  extractRequesterEmail,
  sendAgentReply,
  sendInternalNoteNotification,
} from '@/lib/email';
import { supportTeamRecipients } from '@/lib/support-team';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * A ticket's comments. The ticket is found with one organisation-level
 * request rather than one request per project (#7387). 400 for a bad id, 401
 * without a session, 404 when the ticket cannot be found, 500 otherwise.
 */
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

    // One lookup, not one request per project in turn (#7387).
    const found = await devopsService.findProjectForWorkItem(ticketId);
    if (!found) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }
    const comments = await devopsService.getWorkItemComments(found.project.name, ticketId);
    return NextResponse.json({ comments });
  } catch (error) {
    console.error('Error fetching comments:', error);
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 });
  }
}

/**
 * Add a comment to a ticket. `isInternal: true` stores it as an internal note,
 * which is never emailed.
 *
 * A public reply on a ticket that arrived by email is also emailed to the
 * requester, quoting the earlier public conversation -- without the
 * requester's own replies, which they already have (#7722) -- and blind-copied
 * to the assignee. The email is sent after responding and cannot fail the
 * comment.
 *
 * 400 for an empty comment or one forging the email-origin marker, 401 without
 * a session, 404 when the ticket cannot be found, 500 otherwise.
 */
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

    if (typeof comment !== 'string' || comment.trim() === '') {
      return NextResponse.json({ error: 'Comment is required' }, { status: 400 });
    }

    // The author shown against a comment is read from an email-origin marker in
    // its own text, so a caller able to write that marker could post under
    // somebody else's address. Only email ingest legitimately produces it, and
    // it does not come through here.
    if (claimsEmailOrigin(comment)) {
      return NextResponse.json(
        { error: 'A comment cannot begin with an email-origin marker.' },
        { status: 400 }
      );
    }

    const organization = request.headers.get('x-devops-org') || undefined;
    const devopsService = new AzureDevOpsService(session.accessToken, organization);

    // One lookup, not one request per project in turn (#7387).
    const found = await devopsService.findProjectForWorkItem(ticketId);
    if (!found) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }
    const { project, workItem } = found;

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
        const requester = (extractRequesterEmail(tags) || '').toLowerCase();
        priorHistory = existing
          // On the structured field, not the marker text. The marker is
          // stripped when comments are read, so a text match silently
          // stops excluding anything -- and this history is emailed to
          // the customer.
          .filter((c) => !c.isInternal)
          // The customer already has their own replies in their Sent
          // folder and in the thread; quoting them back made each one
          // show up again in their inbox (#7722).
          .filter((c) => !requester || (c.author.email || '').toLowerCase() !== requester)
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

    // An internal note is kept from the customer, which until now meant it
    // reached nobody at all: a handover written on the ticket sat unread until
    // somebody happened to open it (7767). The author is dropped from the
    // list, since they know what they just wrote.
    if (isInternal) {
      // Best-effort, and guarded: the note is already on the ticket, so
      // nothing here may turn a write that succeeded into a failed request.
      try {
        const recipients = supportTeamRecipients([session.user?.email]);
        if (recipients.length > 0) {
          const subject = workItem.fields?.['System.Title'] || 'Ticket';
          sendInternalNoteNotification({
            ticketId,
            ticketSubject: String(subject),
            authorName: session.user?.name || 'A colleague',
            noteHtml: comment,
            recipients: recipients.join(', '),
          }).catch(() => {});
        } else {
          console.log(
            `[Notify] SUPPORT_TEAM_NOTIFY_EMAIL not set — nobody told about the internal note on ticket #${ticketId}`
          );
        }
      } catch (err) {
        console.error(`[Notify] Internal note email failed for ticket #${ticketId}:`, err);
      }
    }

    if (isEmail) {
      const requesterEmail = extractRequesterEmail(tags);
      if (requesterEmail) {
        const subject = workItem.fields?.['System.Title'] || 'Your ticket';
        const agentName = session.user?.name || 'Support Agent';
        // Fire-and-forget — never block the response on outbound mail.
        // Blind-copy the assigned engineer so the thread reaches the
        // person who owns the ticket, not only the customer (#7384).
        // DevOps stores the identity as "Display Name <email>" or a bare
        // address depending on how it was set, so take whichever is there.
        const assignedTo = workItem.fields?.['System.AssignedTo'];
        const assigneeEmail =
          typeof assignedTo === 'string'
            ? assignedTo
            : (assignedTo as { uniqueName?: string } | undefined)?.uniqueName;

        sendAgentReply(
          ticketId,
          subject,
          requesterEmail,
          agentName,
          comment,
          undefined,
          priorHistory,
          assigneeEmail
        ).catch(() => {});
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error adding comment:', error);
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 });
  }
}
