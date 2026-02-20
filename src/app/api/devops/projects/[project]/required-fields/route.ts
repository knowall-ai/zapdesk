import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { validateOrganizationAccess } from '@/lib/devops-auth';
import { resolveAllowedValues, type DevOpsField } from '@/lib/devops-fields';

// Fields already handled by the form — exclude from dynamic required fields
const HANDLED_FIELDS = new Set([
  'System.Title',
  'System.Description',
  'System.Tags',
  'System.State',
  'System.AssignedTo',
  'System.WorkItemType',
  'System.AreaPath',
  'System.TeamProject',
  'System.IterationPath',
  'System.Reason',
]);

function isHandledField(referenceName: string, name: string): boolean {
  if (HANDLED_FIELDS.has(referenceName)) return true;
  // Exclude priority fields — handled separately by the priority picker
  if (name.toLowerCase().includes('priority')) return true;
  return false;
}

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
      return NextResponse.json({ fields: [] });
    }

    const data = await response.json();
    const allFields: (DevOpsField & {
      required?: boolean;
      alwaysRequired?: boolean;
      defaultValue?: string;
      allowedValues?: string[];
    })[] = data.value || [];

    // Filter to required fields we don't already handle, plus fields with
    // constrained allowed values and a default that may be invalid per type
    // (e.g. Microsoft.VSTS.Common.ValueArea defaults to "Internal" on some
    // process templates but Bug only allows "Business"/"Architectural").
    const requiredFields = allFields.filter((f) => {
      if (isHandledField(f.referenceName, f.name)) return false;
      if (f.required || f.alwaysRequired) return true;
      // Include fields with constrained values and a default — the default
      // may not be valid for the selected work item type.
      if (f.defaultValue && f.allowedValues && f.allowedValues.length > 0) return true;
      return false;
    });

    // Resolve allowed values for each required field
    const fieldsWithValues = await Promise.all(
      requiredFields.map(async (field) => {
        const allowedValues = await resolveAllowedValues(
          field,
          organization,
          projectName,
          workItemType,
          authHeaders
        );

        return {
          referenceName: field.referenceName,
          name: field.name,
          type: field.type || 'string',
          allowedValues: allowedValues.length > 0 ? allowedValues : undefined,
        };
      })
    );

    return NextResponse.json({ fields: fieldsWithValues });
  } catch (error) {
    console.error('Error fetching required fields:', error);
    return NextResponse.json({ error: 'Failed to fetch required fields' }, { status: 500 });
  }
}
