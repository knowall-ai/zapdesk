import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService, DevOpsApiError, workItemToTicket } from '@/lib/devops';
import { isEmailTicket, extractRequesterEmail, sendStatusChangeNotification } from '@/lib/email';
import {
  MAX_WORK_ITEM_ID,
  MAX_PROJECT_LENGTH,
  MAX_STATE_LENGTH,
  validateJsonObject,
  rejectUnknownKeys,
  validateRequiredString,
  validateOptionalString,
} from '@/lib/devops-request-validation';
import { debugLog } from '@/lib/debug';

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

    const bodyResult = validateJsonObject(rawBody);
    if (!bodyResult.ok) {
      return NextResponse.json({ error: bodyResult.error }, { status: bodyResult.status });
    }

    const keysResult = rejectUnknownKeys(bodyResult.data, ['state', 'project']);
    if (!keysResult.ok) {
      return NextResponse.json({ error: keysResult.error }, { status: keysResult.status });
    }

    const { state: rawState, project: rawProject } = bodyResult.data;

    const stateResult = validateRequiredString(rawState, 'state', MAX_STATE_LENGTH);
    if (!stateResult.ok) {
      return NextResponse.json({ error: stateResult.error }, { status: stateResult.status });
    }
    const state = stateResult.data;

    // `project` is an optional hint that skips the cross-project scan. A blank
    // value is treated as absent rather than rejected: callers read it off a
    // work item whose project can legitimately be empty, and the scan below is
    // a correct fallback for exactly that case.
    const projectHint =
      typeof rawProject === 'string' && rawProject.trim() === '' ? undefined : rawProject;
    const projectResult = validateOptionalString(projectHint, 'project', MAX_PROJECT_LENGTH);
    if (!projectResult.ok) {
      return NextResponse.json({ error: projectResult.error }, { status: projectResult.status });
    }
    const project = projectResult.data;

    const organization = request.headers.get('x-devops-org') || undefined;
    const devopsService = new AzureDevOpsService(session.accessToken, organization);

    debugLog('[state PATCH] incoming', {
      ticketId,
      state,
      project,
      organization,
    });

    // If project is provided in the body, use it directly
    if (project) {
      // Snapshot old state first so the email shows the transition.
      let oldState: string | undefined;
      try {
        const existing = await devopsService.getWorkItem(project, ticketId);
        oldState = existing?.fields?.['System.State'];
      } catch {
        // Continue without old state — the transition message will say "Unknown".
      }

      const updatedWorkItem = await devopsService.updateTicketState(project, ticketId, state);
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
