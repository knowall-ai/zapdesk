import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService, DevOpsApiError, workItemToTicket } from '@/lib/devops';
import { resolveStateForStatus, categoriesForStatus } from '@/lib/state-categories';
import type { TicketStatus } from '@/types';

const VALID_STATUSES: TicketStatus[] = [
  'New',
  'Open',
  'In Progress',
  'Pending',
  'Resolved',
  'Closed',
];

/** Azure DevOps work item ids are positive int32 values. */
const MAX_WORK_ITEM_ID = 2_147_483_647;
/** Azure DevOps caps project names at 64 characters. */
const MAX_PROJECT_LENGTH = 64;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    // parseInt alone accepts "123abc" and forwards 123.
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

    const { status, project, ...unknownKeys } = rawBody as Record<string, unknown>;

    const unknown = Object.keys(unknownKeys);
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: `Unexpected field(s) in request body: ${unknown.join(', ')}` },
        { status: 400 }
      );
    }

    if (typeof status !== 'string' || !VALID_STATUSES.includes(status as TicketStatus)) {
      return NextResponse.json(
        { error: `Status must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }
    const ticketStatus = status as TicketStatus;

    if (project !== undefined && typeof project !== 'string') {
      return NextResponse.json({ error: 'project must be a string' }, { status: 400 });
    }
    // Trimmed before use: the value goes into the DevOps URL, so " Team A "
    // and "Team A" are not the same project. Blank means absent.
    const trimmedProject = typeof project === 'string' ? project.trim() : '';
    if (trimmedProject.length > MAX_PROJECT_LENGTH) {
      return NextResponse.json({ error: 'project is too long' }, { status: 400 });
    }
    const projectHint = trimmedProject || undefined;

    const organization = request.headers.get('x-devops-org') || undefined;
    const devopsService = new AzureDevOpsService(session.accessToken, organization);

    // Locate the work item. We need its type and current state, not just its
    // project: the state name to write depends on both.
    let projectName: string | undefined;
    let workItem;

    if (projectHint) {
      try {
        workItem = await devopsService.getWorkItem(projectHint, ticketId);
        if (workItem) projectName = projectHint;
      } catch (lookupError) {
        // A stale hint from the client is recoverable — fall through to the
        // cross-project search. Anything else is a real failure and must not
        // be reported later as "not found".
        if (!(lookupError instanceof DevOpsApiError) || lookupError.status !== 404) {
          throw lookupError;
        }
      }
    }

    if (!workItem) {
      const found = await devopsService.findProjectForWorkItem(ticketId);
      if (found) {
        projectName = found.project.name;
        workItem = found.workItem;
      }
    }

    if (!workItem || !projectName) {
      return NextResponse.json({ error: `Ticket ${ticketId} not found` }, { status: 404 });
    }

    const workItemType = String(workItem.fields?.['System.WorkItemType'] || '');
    const currentState = workItem.fields?.['System.State']
      ? String(workItem.fields['System.State'])
      : undefined;

    // Resolve against the states this type actually defines, rather than a
    // global name map. See src/lib/state-categories.ts for why (issue #297).
    const states = workItemType
      ? await devopsService.getWorkItemTypeStates(projectName, workItemType)
      : [];

    // An empty list means the lookup failed, not that the type has no states —
    // getWorkItemTypeStates returns [] for a non-OK response as well. Reporting
    // that as a workflow rejection would tell the user a transient fault is
    // permanent, which is the kind of misleading error this PR exists to remove.
    if (states.length === 0) {
      return NextResponse.json(
        {
          error: `Could not read the states defined for ${workItemType || 'this work item'}. Please try again.`,
        },
        { status: 502 }
      );
    }

    const devOpsState = resolveStateForStatus(ticketStatus, states, currentState);

    if (!devOpsState) {
      // Say what went wrong. The old code guessed a state name and let DevOps
      // answer with a raw rule error the UI then swallowed.
      const available = states.map((s) => s.name).join(', ');
      return NextResponse.json(
        {
          error:
            `${workItemType || 'This work item'} has no state matching "${ticketStatus}" ` +
            `(looked for ${categoriesForStatus(ticketStatus).join(' or ')}). ` +
            `States available: ${available}.`,
        },
        { status: 409 }
      );
    }

    const updatedWorkItem = await devopsService.updateTicketState(
      projectName,
      ticketId,
      devOpsState
    );

    const ticket = workItemToTicket(updatedWorkItem);
    return NextResponse.json({ ticket, state: devOpsState });
  } catch (error) {
    console.error('Error updating ticket status:', error);
    // Pass through the upstream reason for workflow rejections and auth
    // failures; keep everything else a 500.
    if (error instanceof DevOpsApiError) {
      const passThrough = [400, 401, 403, 404, 409];
      const status = passThrough.includes(error.status) ? error.status : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Failed to update ticket status' }, { status: 500 });
  }
}
