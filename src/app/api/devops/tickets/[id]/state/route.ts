import { NextRequest, NextResponse } from 'next/server';
import { getServerSessionWithToken } from '@/lib/server-session';
import { parseWorkItemId } from '@/lib/work-item-id';
import {
  AzureDevOpsService,
  DevOpsApiError,
  StateNotAvailableError,
  workItemToTicket,
} from '@/lib/devops';
import { sendStatusChangeNotification, assigneeEmailFrom } from '@/lib/email';
import { notifiesCustomer, stateMoved, statusChangeRecipient } from '@/lib/status-notification';
import { debugLog } from '@/lib/debug';
import { describeFields } from '@/lib/describe-fields';
import { FIELD_REFERENCE } from '@/lib/rule-validation';
import type { RequiredField } from '@/hooks/useWorkItemActions';

/** Azure DevOps work item ids are positive int32 values. */
/** Generous bound on a process-template state name. */
const MAX_STATE_LENGTH = 128;
/** Azure DevOps caps project names at 64 characters. */
const MAX_PROJECT_LENGTH = 64;
/** No transition in any process requires anything like this many. */
const MAX_ADDITIONAL_FIELDS = 20;
/** Generous for an identity string or a date; short of a description. */
const MAX_FIELD_VALUE_LENGTH = 1024;
/**
 * Fields this route decides for itself, or that belong to another one. A
 * caller must not be able to move the ticket somewhere other than the state it
 * named, nor rewrite the tags the notification below reads its recipient from.
 */
const RESERVED_FIELDS = new Set([
  'System.State',
  'System.Id',
  'System.WorkItemType',
  'System.TeamProject',
  'System.Tags',
  'System.CreatedBy',
  'System.ChangedBy',
]);

/**
 * Where a refused update was headed, so the fields it left empty can be
 * described for the dialog that asks for them (#663).
 */
interface RefusalContext {
  accessToken: string;
  organization: string;
  project: string;
  workItemType: string;
}

/**
 * The longest a refusal waits to have its fields described. The refusal is
 * already known; the descriptions only improve the controls, and several
 * metadata reads each with their own timeout could otherwise hold the answer
 * back for half a minute (#663 review).
 */
const DESCRIBE_DEADLINE_MS = 5_000;

/** A field asked for by name only: a text box, which DevOps still checks. */
const byName = (referenceName: string): RequiredField => ({
  referenceName,
  name: referenceName,
  type: 'string',
});

/**
 * The fields to ask for, described where possible, or nothing when there is
 * nothing a required-fields dialog could fix. Never throws: this only
 * improves an error response, and failing here must not replace the error
 * being reported.
 *
 * The names stand on their own. Without the context to describe them --
 * the work item could not be read first -- or when describing them fails or
 * runs out of time, each is offered by name as text rather than dropped, so
 * the board can still ask (#663 review).
 */
async function missingFieldsFor(
  error: DevOpsApiError,
  context: RefusalContext | undefined
): Promise<RequiredField[]> {
  if (error.status !== 400) return [];
  const askable = error.missingFields.filter(
    (field) => FIELD_REFERENCE.test(field) && !RESERVED_FIELDS.has(field)
  );
  if (askable.length === 0 || askable.length > MAX_ADDITIONAL_FIELDS) return [];
  if (!context) return askable.map(byName);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), DESCRIBE_DEADLINE_MS);
  });
  try {
    const described = await Promise.race([
      describeFields(askable, {
        organization: context.organization,
        project: context.project,
        workItemType: context.workItemType,
        authHeaders: {
          Authorization: `Bearer ${context.accessToken}`,
          'Content-Type': 'application/json',
        },
      }),
      deadline,
    ]);
    if (described) return described;
    console.error('Describing the fields a refused update needs ran out of time');
  } catch (describeError) {
    console.error('Could not describe the fields a refused update needs:', describeError);
  } finally {
    clearTimeout(timer);
  }
  return askable.map(byName);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let refusal: RefusalContext | undefined;
  try {
    const session = await getServerSessionWithToken();

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    // parseInt would have accepted "123abc" and forwarded 123 to DevOps.
    // Work item ids are positive int32s upstream, so cap accordingly.
    if (!/^[0-9]+$/.test(id)) {
      return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 });
    }
    const ticketId = parseWorkItemId(id);
    if (ticketId === null) {
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

    const { state, project, additionalFields, ...unknownKeys } = rawBody as Record<string, unknown>;

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

    // Fields the process requires for this transition (#651). Validated here
    // rather than trusted: the values are written straight into a work item,
    // so the keys must look like field reference names and nothing may set a
    // field this route is responsible for. `System.State` is the obvious one
    // -- accepting it would let a caller move the ticket somewhere other than
    // the state it asked for, and past the notification below, which reads the
    // state it believes it set.
    const extraFields: Record<string, string> = {};
    if (additionalFields !== undefined) {
      if (
        typeof additionalFields !== 'object' ||
        additionalFields === null ||
        Array.isArray(additionalFields)
      ) {
        return NextResponse.json(
          { error: 'additionalFields must be a JSON object' },
          { status: 400 }
        );
      }
      const entries = Object.entries(additionalFields as Record<string, unknown>);
      if (entries.length > MAX_ADDITIONAL_FIELDS) {
        return NextResponse.json({ error: 'Too many additional fields' }, { status: 400 });
      }
      for (const [field, value] of entries) {
        if (!FIELD_REFERENCE.test(field)) {
          return NextResponse.json(
            { error: `Not a work item field name: ${field}` },
            { status: 400 }
          );
        }
        if (RESERVED_FIELDS.has(field)) {
          return NextResponse.json(
            { error: `${field} cannot be set through this route` },
            { status: 400 }
          );
        }
        if (typeof value !== 'string') {
          return NextResponse.json({ error: `${field} must be a string` }, { status: 400 });
        }
        if (value.length > MAX_FIELD_VALUE_LENGTH) {
          return NextResponse.json({ error: `${field} is too long` }, { status: 400 });
        }
        // A blank value means "not given". An optional field the user left
        // empty must not go to DevOps as an attempt to set it to nothing.
        if (value.trim() === '') continue;
        extraFields[field] = value;
      }
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
      // Snapshot the old state first: the customer is only told when it moved.
      let oldState: string | undefined;
      try {
        const existing = await devopsService.getWorkItem(projectHint, ticketId);
        oldState = existing?.fields?.['System.State'];
        const workItemType = existing?.fields?.['System.WorkItemType'];
        if (organization && typeof workItemType === 'string' && workItemType) {
          refusal = {
            accessToken: session.accessToken,
            organization,
            project: projectHint,
            workItemType,
          };
        }
      } catch {
        // Continue without it. The update still goes ahead; the customer is
        // not mailed, because a move from an unknown state would be a guess.
      }

      const updatedWorkItem = await devopsService.updateTicketState(
        projectHint,
        ticketId,
        state,
        extraFields
      );
      notifyStateChange(updatedWorkItem, ticketId, oldState, state);
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

      const oldState: string | undefined = workItem.fields?.['System.State'] || undefined;
      const workItemType = workItem.fields?.['System.WorkItemType'];
      if (organization && typeof workItemType === 'string' && workItemType) {
        refusal = {
          accessToken: session.accessToken,
          organization,
          project: project.name,
          workItemType,
        };
      }

      const updatedWorkItem = await devopsService.updateTicketState(
        project.name,
        ticketId,
        state,
        extraFields
      );

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
      // The type has no such state: say which type, so the user knows the
      // choice cannot be made for this ticket at all (#725).
      if (error instanceof StateNotAvailableError) {
        const message = refusal?.workItemType
          ? `The "${error.state}" state is not available for the ${refusal.workItemType} work item type.`
          : error.message;
        return NextResponse.json({ error: message }, { status });
      }
      // A rule that wanted fields filled in names them. Hand them back so the
      // board can ask for them -- the rules lookup before the drag fails open
      // when the user may not read process rules, and this is then the only
      // place the answer comes from (#663).
      const missingFields = await missingFieldsFor(error, refusal);
      if (missingFields.length > 0) {
        // The project the item was found in, so a card that came without one
        // can still list the people a field wants.
        return NextResponse.json(
          { error: error.message, missingFields, project: refusal?.project },
          { status }
        );
      }
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Failed to update ticket state' }, { status: 500 });
  }
}

/**
 * Fire-and-forget email to the customer about a state change.
 *
 * Sent only when all of these hold, and each reason to stay quiet leaves a
 * line in the log:
 *
 * - The state really moved. Compared with what DevOps saved rather than with
 *   what was asked for, and an unreadable old state sends nothing rather than
 *   "Unknown -> X".
 * - The ticket arrived by email. #654 extended this to every ticket, mailing
 *   whoever created the work item -- usually a colleague, not a customer.
 * - The new state is one customers are told about.
 */
function notifyStateChange(
  workItem: { fields?: Record<string, unknown> },
  ticketId: number,
  oldState: string | undefined,
  requestedState: string
) {
  const savedState = workItem.fields?.['System.State'];
  const newState =
    typeof savedState === 'string' && savedState.trim() ? savedState : requestedState;

  if (!oldState || !stateMoved(oldState, newState)) {
    console.log(
      oldState
        ? `[Email] Ticket #${ticketId} is still ${newState} - the state did not move, not notifying.`
        : `[Email] Ticket #${ticketId} moved to ${newState}, but its earlier state could not be read - not notifying.`
    );
    return;
  }

  const requesterEmail = statusChangeRecipient(workItem.fields);
  if (!requesterEmail) {
    console.log(
      `[Email] Ticket #${ticketId} moved to ${newState}, but it did not arrive by email (or has no usable email-from tag) - not notifying.`
    );
    return;
  }

  if (!notifiesCustomer(newState)) {
    console.log(
      `[Email] Ticket #${ticketId} moved to ${newState}, which customers are not told about - not notifying.`
    );
    return;
  }

  const subject = String(workItem.fields?.['System.Title'] || 'Your ticket');
  // Blind-copy the assigned engineer: this message is part of the customer's
  // thread, and until now only the agent's own replies reached them (#7384).
  const assigneeEmail = assigneeEmailFrom(workItem.fields?.['System.AssignedTo']);
  sendStatusChangeNotification(
    ticketId,
    subject,
    requesterEmail,
    oldState,
    newState,
    undefined,
    assigneeEmail,
    // The customer's organisation, so their manager is copied if one is set.
    String(workItem.fields?.['System.TeamProject'] ?? '')
  ).catch(() => {});
}
