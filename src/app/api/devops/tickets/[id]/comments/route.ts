import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService, claimsEmailOrigin } from '@/lib/devops';
import { isEmailTicket, extractRequesterEmail, sendAgentReply } from '@/lib/email';
import {
  MAX_WORK_ITEM_ID,
  MAX_COMMENT_LENGTH,
  validateJsonObject,
  rejectUnknownKeys,
  validateRequiredString,
  validateOptionalBoolean,
} from '@/lib/devops-request-validation';

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
    if (!/^[0-9]+$/.test(id)) {
      return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 });
    }
    const ticketId = parseInt(id, 10);
    if (ticketId <= 0 || ticketId > MAX_WORK_ITEM_ID) {
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
    if (!/^[0-9]+$/.test(id)) {
      return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 });
    }
    const ticketId = parseInt(id, 10);
    if (ticketId <= 0 || ticketId > MAX_WORK_ITEM_ID) {
      return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
    }

    const bodyResult = validateJsonObject(rawBody);
    if (!bodyResult.ok) {
      return NextResponse.json({ error: bodyResult.error }, { status: bodyResult.status });
    }

    const keysResult = rejectUnknownKeys(bodyResult.data, ['comment', 'isInternal']);
    if (!keysResult.ok) {
      return NextResponse.json({ error: keysResult.error }, { status: keysResult.status });
    }

    const { comment: rawComment, isInternal: rawIsInternal } = bodyResult.data;

    const commentResult = validateRequiredString(rawComment, 'comment', MAX_COMMENT_LENGTH);
    if (!commentResult.ok) {
      return NextResponse.json({ error: commentResult.error }, { status: commentResult.status });
    }
    const comment = commentResult.data;

    const isInternalResult = validateOptionalBoolean(rawIsInternal, 'isInternal');
    if (!isInternalResult.ok) {
      return NextResponse.json(
        { error: isInternalResult.error },
        { status: isInternalResult.status }
      );
    }
    const isInternal = isInternalResult.data;

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
