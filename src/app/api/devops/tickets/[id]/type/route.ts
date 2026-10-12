import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService, workItemToTicket } from '@/lib/devops';
import { validateOrganizationAccess } from '@/lib/devops-auth';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
    }

    // A null or array body used to reach the destructure and surface as a 500.
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }

    const { type, project, additionalFields, ...unknownKeys } = body as Record<string, unknown>;

    // Say what was ignored rather than silently dropping it — a caller sending
    // a key we don't honour should learn that, not assume it took effect.
    const unknown = Object.keys(unknownKeys);
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: `Unexpected field(s) in request body: ${unknown.join(', ')}` },
        { status: 400 }
      );
    }

    if (typeof type !== 'string' || type.trim().length === 0) {
      return NextResponse.json({ error: 'Type is required' }, { status: 400 });
    }
    if (type.length > 128) {
      return NextResponse.json({ error: 'Type is too long' }, { status: 400 });
    }

    // `project` is accepted but never used to resolve anything. Every caller
    // in the app sends it, so rejecting it as an unknown key would break the
    // feature outright — but a client's idea of the owning project can be
    // stale after a move, which is the bug this PR exists to fix (#294). The
    // org-level lookup below stays the source of truth.
    //
    // A blank value is treated as absent rather than rejected: it is a hint we
    // ignore, so 400-ing a caller whose `ticket.project` happens to be empty
    // would fail a request that would otherwise have succeeded.
    if (project !== undefined && typeof project !== 'string') {
      return NextResponse.json({ error: 'project must be a string' }, { status: 400 });
    }

    const organization = request.headers.get('x-devops-org');
    if (!organization) {
      return NextResponse.json({ error: 'No organization specified' }, { status: 400 });
    }

    const hasAccess = await validateOrganizationAccess(session.accessToken, organization);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Access denied to the specified organization' },
        { status: 403 }
      );
    }

    const devopsService = new AzureDevOpsService(session.accessToken, organization);

    // Validate additionalFields if provided — only allow safe field prefixes.
    // Rejecting beats filtering: a caller who sends a forbidden field should
    // get an error, not a successful type change with their field quietly
    // dropped.
    let validatedAdditionalFields: Record<string, string | number> | undefined;
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

      const ALLOWED_PREFIXES = ['Custom.', 'Microsoft.VSTS.'];
      const accepted: Record<string, string | number> = {};
      const rejected: string[] = [];

      for (const [key, value] of Object.entries(additionalFields)) {
        const keyAllowed =
          !key.includes('/') &&
          !key.includes('\\') &&
          ALLOWED_PREFIXES.some((p) => key.startsWith(p));
        const valueAllowed = typeof value === 'string' || typeof value === 'number';
        if (keyAllowed && valueAllowed) {
          accepted[key] = value as string | number;
        } else {
          rejected.push(key);
        }
      }

      if (rejected.length > 0) {
        return NextResponse.json(
          {
            error: `Field(s) not permitted here: ${rejected.join(', ')}. Allowed prefixes: ${ALLOWED_PREFIXES.join(', ')}; values must be a string or number.`,
          },
          { status: 400 }
        );
      }

      if (Object.keys(accepted).length > 0) {
        validatedAdditionalFields = accepted;
      }
    }

    // Resolve the owning project from the WIT API. This is the source of
    // truth: clients may not know (or may have a stale guess of) which
    // project owns the ticket, especially after a move. One org-level
    // work-item fetch is cheaper and more reliable than the older
    // findProjectForWorkItem iteration that silently swallowed per-project
    // errors and surfaced bogus 404s.
    let projectName: string | undefined;
    try {
      const orgWorkItem = await devopsService.getWorkItemByIdOrgLevel(ticketId, [
        'System.TeamProject',
      ]);
      if (!orgWorkItem) {
        return NextResponse.json(
          { error: `Ticket ${ticketId} not found in this organization` },
          { status: 404 }
        );
      }
      projectName = orgWorkItem.fields['System.TeamProject'] as string;
    } catch (err) {
      console.error(`Org-level lookup failed for ticket ${ticketId}:`, err);
      return NextResponse.json(
        {
          error: `Could not resolve the project for ticket ${ticketId}: ${err instanceof Error ? err.message : 'unknown error'}`,
        },
        { status: 500 }
      );
    }

    if (!projectName) {
      return NextResponse.json(
        { error: `Ticket ${ticketId} has no project assigned` },
        { status: 404 }
      );
    }

    const updatedWorkItem = await devopsService.changeWorkItemType(
      projectName,
      ticketId,
      type,
      validatedAdditionalFields
    );
    const ticket = workItemToTicket(updatedWorkItem);
    return NextResponse.json({ ticket });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to change work item type';
    console.error('Error changing work item type:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
