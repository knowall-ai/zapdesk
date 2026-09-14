import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService, DevOpsApiError, workItemToTicket } from '@/lib/devops';
import { isEmailTicket, extractRequesterEmail, sendStatusChangeNotification } from '@/lib/email';
import { debugLog } from '@/lib/debug';

/** Azure DevOps work item ids are positive int32 values. */
const MAX_WORK_ITEM_ID = 2_147_483_647;
/** Generous bound on a process-template state name. */
const MAX_STATE_LENGTH = 128;
/** Azure DevOps caps project names at 64 characters. */
const MAX_PROJECT_LENGTH = 64;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    // parseInt would have accepted "123abc" and forwarded 123 to DevOps.
    // Work item ids are positive int32s upstream, so cap accordingly.
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
    if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }

    const { state, project, ...unknownKeys } = rawBody as Record<string, unknown>;

    // Say what was ignored rather than dropping it silently — a caller sending
    // a key we do not honour should learn that, not assume it took effect.
    const unknown = Object.keys(unknownKeys);
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: `Unexpected field(s) in request body: ${unknown.join(', ')}` },
        { status: 400 }
      );
    }

    if (typeof state !== 'string' || state.trim().length === 0) {
      return NextResponse.json({ error: 'State is required' }, { status: 400 });
    }
    if (state.length > MAX_STATE_LENGTH) {
      return NextResponse.json({ error: 'State is too long' }, { status: 400 });
    }

    // `project` is an optional hint that skips the cross-project scan. A blank
    // value is treated as absent rather than rejected: callers read it off a
    // work item whose project can legitimately be empty, and the scan below is
    // a correct fallback for exactly that case.
    if (project !== undefined && typeof project !== 'string') {
      return NextResponse.json({ error: 'project must be a string' }, { status: 400 });
    }
    // Trim before use: the value goes into the DevOps URL, and " Team A "
    // and "Team A" are not the same project identifier upstream.
    const trimmedProject = typeof project === 'string' ? project.trim() : '';
    if (trimmedProject.length > MAX_PROJECT_LENGTH) {
      return NextResponse.json({ error: 'project is too long' }, { status: 400 });
    }
    const projectHint = trimmedProject || undefined;

    const organization = request.headers.get('x-devops-org') || undefined;
    const devopsService = new AzureDevOpsService(session.accessToken, organization);

    debugLog('[state PATCH] incoming', {
      ticketId,
      state,
      project: projectHint,
      organization,
    });

    // If project is provided in the body, use it directly
    if (projectHint) {
      // Snapshot old state first so the email shows the transition.
      let oldState: string | undefined;
      try {
        const existing = await devopsService.getWorkItem(projectHint, ticketId);
        oldState = existing?.fields?.['System.State'];
      } catch {
        // Continue without old state — the transition message will say "Unknown".
      }

      const updatedWorkItem = await devopsService.updateTicketState(projectHint, ticketId, state);
      notifyStateChange(updatedWorkItem, ticketId, oldState || 'Unknown', state);
      const ticket = workItemToTicket(updatedWorkItem);
      return NextResponse.json({ ticket });
    }

    // Fallback: search all projects to find the ticket
    const projects = await devopsService.getProjects();

    for (const project of projects) {
      let workItem;
      try {
        workItem = await devopsService.getWorkItem(project.name, ticketId);
      } catch (lookupError) {
        // Only a genuine 404 means "not in this project" — 401/429/5xx are
        // real failures and must not be reported as a missing ticket. The
        // update below never falls through here either, or a rejected
        // transition would surface as "Ticket not found" (issue #391).
        if (lookupError instanceof DevOpsApiError && lookupError.status === 404) continue;
        throw lookupError;
      }
      if (!workItem) continue;

      const oldState = workItem.fields?.['System.State'] || 'Unknown';

      const updatedWorkItem = await devopsService.updateTicketState(project.name, ticketId, state);

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

    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  } catch (error) {
    console.error('Error updating ticket state:', error);
    // Pass through the upstream message for blocked state transitions and
    // similar workflow errors — collapsing everything to a generic 500
    // means the UI can't tell the user *why* the drag failed (issue #391).
    if (error instanceof DevOpsApiError) {
      // 400/409 are workflow rejections; 401/403/404 are auth, permission and
      // missing-item failures the client can act on — anything else is genuinely
      // ours to own, so it stays a 500.
      const passThrough = [400, 401, 403, 404, 409];
      const status = passThrough.includes(error.status) ? error.status : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
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
