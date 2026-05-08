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

    const body = await request.json();
    const { type, project, additionalFields } = body;

    if (!type) {
      return NextResponse.json({ error: 'Type is required' }, { status: 400 });
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

    // Validate additionalFields if provided — only allow safe field prefixes
    let validatedAdditionalFields: Record<string, string | number> | undefined;
    if (additionalFields && typeof additionalFields === 'object') {
      const ALLOWED_PREFIXES = ['Custom.', 'Microsoft.VSTS.'];
      const DENIED_PREFIXES = ['System.'];
      const filtered: Record<string, string | number> = {};

      for (const [key, value] of Object.entries(additionalFields)) {
        if (typeof key !== 'string' || key.includes('/') || key.includes('\\')) continue;
        if (DENIED_PREFIXES.some((p) => key.startsWith(p))) continue;
        if (!ALLOWED_PREFIXES.some((p) => key.startsWith(p))) continue;
        if (typeof value === 'string' || typeof value === 'number') {
          filtered[key] = value;
        }
      }

      if (Object.keys(filtered).length > 0) {
        validatedAdditionalFields = filtered;
      }
    }

    // Resolve the project. Prefer the body field (cheap, no extra Graph call)
    // but fall back to fetching the work item at the org level, which works
    // regardless of which project owns it. This replaces the older
    // findProjectForWorkItem iteration that was prone to silent 404s when one
    // of the cached projects no longer permitted a getWorkItem call.
    let projectName: string | undefined =
      typeof project === 'string' && project.trim() ? project.trim() : undefined;

    if (!projectName) {
      try {
        const orgWorkItem = await devopsService.getWorkItemByIdOrgLevel(ticketId);
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
