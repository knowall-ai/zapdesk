import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { validateOrganizationAccess } from '@/lib/devops-auth';
import { resolveAllowedValues, type DevOpsField } from '@/lib/devops-fields';

// Allowed priority field reference names to prevent arbitrary field injection
const ALLOWED_PRIORITY_FIELDS = new Set([
  'Microsoft.VSTS.Common.Priority',
  'Custom.PriorityLevel',
  'Microsoft.VSTS.CMMI.Priority',
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ project: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { project } = await params;
    const projectName = decodeURIComponent(project);

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

    const workItemType = request.nextUrl.searchParams.get('workItemType') || 'Task';
    const authHeaders = {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    };

    // Fetch all fields for this work item type
    const response = await fetch(
      `https://dev.azure.com/${organization}/${encodeURIComponent(projectName)}/_apis/wit/workitemtypes/${encodeURIComponent(workItemType)}/fields?api-version=7.0`,
      { headers: authHeaders }
    );

    if (!response.ok) {
      return NextResponse.json({ hasPriority: false, priorities: [], fieldReferenceName: null });
    }

    const data = await response.json();
    const fields: DevOpsField[] = data.value || [];

    // Find priority-related fields by name
    const priorityFields = fields.filter((f) => f.name.toLowerCase().includes('priority'));

    if (priorityFields.length === 0) {
      return NextResponse.json({ hasPriority: false, priorities: [], fieldReferenceName: null });
    }

    // Build a prioritized list: custom PriorityLevel first, then other non-built-in, then built-in
    const prioritizedFields: DevOpsField[] = [];

    for (const finder of [
      (f: DevOpsField) => f.name.toLowerCase().includes('prioritylevel'),
      (f: DevOpsField) => f.name.toLowerCase().includes('priority level'),
      (f: DevOpsField) => f.referenceName !== 'Microsoft.VSTS.Common.Priority',
      (f: DevOpsField) => f.referenceName === 'Microsoft.VSTS.Common.Priority',
    ]) {
      const match = priorityFields.find(finder);
      if (match && !prioritizedFields.includes(match)) {
        prioritizedFields.push(match);
      }
    }

    // Append any remaining fields not yet included
    for (const field of priorityFields) {
      if (!prioritizedFields.includes(field)) {
        prioritizedFields.push(field);
      }
    }

    // Try each candidate field in order until one yields allowed values
    for (const field of prioritizedFields) {
      // Track allowed fields for security validation
      ALLOWED_PRIORITY_FIELDS.add(field.referenceName);

      const allowedValues = await resolveAllowedValues(
        field,
        organization,
        projectName,
        workItemType,
        authHeaders
      );

      if (allowedValues.length > 0) {
        return NextResponse.json({
          hasPriority: true,
          fieldReferenceName: field.referenceName,
          fieldName: field.name,
          priorities: allowedValues.map((value: string) => ({
            value,
            label: value,
          })),
        });
      }
    }

    // No priority field yielded allowed values — hide the priority UI
    return NextResponse.json({ hasPriority: false, priorities: [], fieldReferenceName: null });
  } catch (error) {
    console.error('Error fetching priorities:', error);
    return NextResponse.json({ error: 'Failed to fetch priorities' }, { status: 500 });
  }
}
