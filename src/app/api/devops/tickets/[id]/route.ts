import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  AzureDevOpsService,
  DevOpsApiError,
  attachmentsFromRelations,
  workItemToTicket,
} from '@/lib/devops';
import {
  extractRequesterEmail,
  isEmailTicket,
  sendAssignmentNotification,
  sendTicketUpdateNotification,
} from '@/lib/email';
import type { TicketFieldChange } from '@/lib/email-templates';
import { titleProblem } from '@/lib/ticket-title';

type RouteParams = { params: Promise<{ id: string }> };

/** The body fields PATCH accepts; anything else is refused. */
const PATCH_FIELDS = new Set([
  'assignee',
  'assignToMe',
  'priority',
  'project',
  'title',
  'description',
  'tags',
  'resolution',
  'mitigation',
  'workItemType',
  'completedWork',
  'remainingWork',
]);

/** Lowest priority DevOps uses: 1 is urgent, 4 is low. */
const MAX_PRIORITY = 4;

/**
 * One ticket with its comments and attachments.
 *
 * The work item is found with a single organisation-level request, and its
 * attachments are read from the relations that request already returned
 * (#7387). 400 for a bad id, 401 without a session, 404 when the ticket cannot
 * be found, 500 otherwise.
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
    const found = await devopsService.findProjectForWorkItem(ticketId);

    if (!found) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const ticket = workItemToTicket(found.workItem, {
      id: found.project.id,
      name: found.project.name,
      devOpsProject: found.project.name,
      devOpsOrg: devopsService.organizationName,
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // The lookup fetched the work item with its relations, so the attachments
    // are already in hand; fetching it again only for them doubled the wait.
    const comments = await devopsService.getWorkItemComments(found.project.name, ticketId);
    const attachments = attachmentsFromRelations(found.workItem);

    return NextResponse.json({
      ticket: { ...ticket, attachments },
      comments,
    });
  } catch (error) {
    console.error('Error fetching ticket:', error);
    return NextResponse.json({ error: 'Failed to fetch ticket' }, { status: 500 });
  }
}

// DELETE moves the work item to the DevOps Recycle Bin (reversible).
// Pass ?destroy=true to permanently destroy it. Authorization is enforced
// by DevOps based on the user's role/PAT scope — there is no ZapDesk-side
// admin gate yet (a follow-up to issue #374).
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const ticketId = parseInt(id, 10);

    if (isNaN(ticketId) || ticketId <= 0) {
      return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 });
    }

    const destroy = request.nextUrl.searchParams.get('destroy') === 'true';
    const organization = request.headers.get('x-devops-org') || undefined;
    const devopsService = new AzureDevOpsService(session.accessToken, organization);

    try {
      await devopsService.deleteWorkItem(ticketId, destroy);
    } catch (err) {
      // Map structured upstream failures to clean client-facing statuses
      if (err instanceof DevOpsApiError) {
        if (err.status === 401) {
          return NextResponse.json(
            { error: 'Unauthorized to delete this work item' },
            { status: 401 }
          );
        }
        if (err.status === 403) {
          return NextResponse.json(
            { error: 'You do not have permission to delete this work item in DevOps' },
            { status: 403 }
          );
        }
        if (err.status === 404) {
          return NextResponse.json({ error: 'Work item not found' }, { status: 404 });
        }
      }
      throw err;
    }

    return NextResponse.json({ success: true, id: ticketId, destroyed: destroy });
  } catch (error) {
    // Log full detail server-side; return a generic message so the client
    // toast doesn't echo upstream / internal error text.
    console.error('Error deleting ticket:', error);
    return NextResponse.json({ error: 'Failed to delete ticket' }, { status: 500 });
  }
}

/**
 * Update a ticket's assignee, priority, title, description, tags, resolution
 * or mitigation. `assignToMe: true` assigns the caller.
 *
 * Side effects, after the update is saved:
 * - a new assignee is emailed (#7374);
 * - for a ticket that arrived by email, the requester is emailed when the
 *   title or priority actually changed (#7724). That send is awaited so it is
 *   not lost to a process recycle; it cannot fail the update.
 *
 * The requester is read from the ticket's tags as they were before this
 * request, so a PATCH that also edits the tags cannot redirect that email.
 *
 * Returns `{ ticket }`; 400 for a bad id, an unknown field, a priority outside
 * 1-4 or bad tags; 401 without a session; 404 when the ticket cannot be found;
 * 500 otherwise.
 */
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
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
    }

    // Refuse fields this route does not handle, so a misspelt one is an error
    // rather than an update that silently did nothing.
    const unknownFields = Object.keys(body).filter((key) => !PATCH_FIELDS.has(key));
    if (unknownFields.length > 0) {
      return NextResponse.json(
        { error: `Unknown field: ${unknownFields.join(', ')}` },
        { status: 400 }
      );
    }

    // Priority is 1 (urgent) to 4 (low). Anything else would be passed to
    // DevOps as-is, and it also decides whether the customer is emailed.
    if (
      body.priority !== undefined &&
      !(Number.isInteger(body.priority) && body.priority >= 1 && body.priority <= MAX_PRIORITY)
    ) {
      return NextResponse.json(
        { error: `priority must be a whole number from 1 to ${MAX_PRIORITY}` },
        { status: 400 }
      );
    }

    // A non-list `tags` used to be skipped silently, so a request that also
    // changed the title reported success for an update it half did.
    if (body.tags !== undefined && !Array.isArray(body.tags)) {
      return NextResponse.json({ error: 'tags must be a list of strings' }, { status: 400 });
    }

    // A ticket has to be called something, and DevOps caps the field. Left to
    // DevOps, both come back as a 400 naming neither the field nor the limit.
    // Checked before the project lookup, so bad input costs no DevOps request.
    if (body.title !== undefined) {
      const problem =
        typeof body.title === 'string' ? titleProblem(body.title) : 'A title is required.';
      if (problem) {
        return NextResponse.json({ error: problem }, { status: 400 });
      }
    }

    // Hours must be real, non-negative numbers; DevOps would otherwise reject
    // the whole patch with an error that names none of this. Checked before
    // the project lookup, so bad input costs no DevOps request.
    for (const name of ['completedWork', 'remainingWork'] as const) {
      const value: unknown = body[name];
      if (value === undefined) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return NextResponse.json(
          { error: `${name} must be a number of hours, 0 or more` },
          { status: 400 }
        );
      }
    }

    const {
      assignee,
      assignToMe,
      priority,
      project,
      title,
      description,
      tags,
      resolution,
      mitigation,
      workItemType,
      completedWork,
      remainingWork,
    } = body;

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
      tags?: string[];
      resolution?: string;
      mitigation?: string;
      workItemType?: string;
      completedWork?: number;
      remainingWork?: number;
    } = {};

    // Hours were checked above, before any DevOps lookup.
    if (completedWork !== undefined) updates.completedWork = completedWork;
    if (remainingWork !== undefined) updates.remainingWork = remainingWork;

    if (workItemType) {
      updates.workItemType = workItemType;
    }

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
      // Trimmed, so trailing whitespace cannot make a title look changed when
      // it is not, and so the stored title matches what the customer is shown.
      updates.title = title.trim();
    }

    if (description !== undefined) {
      updates.description = description;
    }

    if (tags !== undefined && Array.isArray(tags)) {
      // Validate each element is a string
      if (!tags.every((t: unknown) => typeof t === 'string')) {
        return NextResponse.json({ error: 'All tags must be strings' }, { status: 400 });
      }
      // Reject tags containing semicolons (DevOps delimiter)
      const cleanTags = (tags as string[]).map((t) => t.trim()).filter(Boolean);
      if (cleanTags.some((t) => t.includes(';'))) {
        return NextResponse.json({ error: 'Tags cannot contain semicolons' }, { status: 400 });
      }
      // Ensure "ticket" tag is always preserved
      if (!cleanTags.some((t) => t.toLowerCase() === 'ticket')) {
        cleanTags.unshift('ticket');
      }
      updates.tags = cleanTags;
    }

    if (resolution !== undefined) {
      updates.resolution = resolution;
    }

    if (mitigation !== undefined) {
      updates.mitigation = mitigation;
    }

    // Snapshot what the customer can see before changing it, so they can be
    // told what changed (#7724). Only fetched when one of those fields moves.
    const customerVisibleChange = title !== undefined || priority !== undefined;
    const before = customerVisibleChange
      ? workItemToTicket(await devopsService.getWorkItem(projectName, ticketId))
      : null;

    // Update the work item
    const updatedWorkItem = await devopsService.updateTicketFields(projectName, ticketId, updates);

    const ticket = workItemToTicket(updatedWorkItem, {
      id: projectName,
      name: projectName,
      devOpsProject: projectName,
      devOpsOrg: devopsService.organizationName,
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Tell the new assignee. DevOps sends nothing for this, so until now a
    // ticket could be handed to someone who only found out by looking (#7374).
    //
    // Fire-and-forget: the assignment is already saved, and a slow mail server
    // must not turn a successful change into a reported failure.
    if (updates.assignee) {
      const assigneeEmail = ticket.assignee?.email;
      if (assigneeEmail) {
        sendAssignmentNotification({
          ticketId,
          subject: ticket.title,
          assigneeEmail,
          assignedByName: session.user?.name || 'A colleague',
          assignedByEmail: session.user?.email ?? undefined,
          requesterEmail: extractRequesterEmail(ticket.tags ?? []) ?? undefined,
        }).catch(() => {});
      }
    }

    // Tell an email customer their ticket's title or priority changed (#7724).
    // Status changes already have their own email (the state route).
    // Recipient from the tags as they were before this request: the same PATCH
    // can rewrite `email` and `email-from:`, and must not be able to silence
    // the notification or send ticket details to an address of its choosing.
    if (before && isEmailTicket(before.tags ?? [])) {
      const requesterEmail = extractRequesterEmail(before.tags ?? []);
      const changes: TicketFieldChange[] = [];
      if (title !== undefined && before.title !== ticket.title) {
        changes.push({ label: 'Title', from: before.title, to: ticket.title });
      }
      if (priority !== undefined && before.priority !== ticket.priority) {
        changes.push({
          label: 'Priority',
          from: before.priority ?? '',
          to: ticket.priority ?? '',
        });
      }
      if (requesterEmail && changes.length > 0) {
        // The mail subject keeps the title the customer already knows, so it
        // lands in their existing thread; the body shows the title as it now
        // is, with the change listed.
        //
        // Awaited, unlike the other notifications: a send left running after
        // the response can be cut off when App Service recycles the process,
        // and the customer would never hear of the change. This cannot fail
        // the update -- the sender logs and swallows its own errors, and its
        // Graph calls time out -- and it only runs when an email ticket's
        // title or priority actually changed.
        //
        // The thread subject is the title the ticket was created with, so it
        // stays the same however many times the title changes; the title
        // before this request is the fallback if history can't be read.
        const threadTitle =
          (await devopsService.getOriginalTitle(projectName, ticketId)) ?? before.title;
        await sendTicketUpdateNotification(
          ticketId,
          { thread: threadTitle, current: ticket.title },
          requesterEmail,
          changes
        );
      }
    }

    return NextResponse.json({ ticket });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update ticket';
    console.error('Error updating ticket:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
