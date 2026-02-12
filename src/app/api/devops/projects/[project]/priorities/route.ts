import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { validateOrganizationAccess } from '@/lib/devops-auth';

interface DevOpsField {
  referenceName: string;
  name: string;
  allowedValues?: string[];
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

    // Fetch all fields for this work item type to find the correct priority field
    const response = await fetch(
      `https://dev.azure.com/${organization}/${encodeURIComponent(projectName)}/_apis/wit/workitemtypes/${encodeURIComponent(workItemType)}/fields?api-version=7.0`,
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      return NextResponse.json({ hasPriority: false, priorities: [], fieldReferenceName: null });
    }

    const data = await response.json();
    const fields: DevOpsField[] = data.value || [];

    // Find priority fields - prefer "Priority Level" (Planning) over "Priority" (Effort)
    const priorityFields = fields.filter(
      (f) =>
        f.name.toLowerCase().includes('priority') && f.allowedValues && f.allowedValues.length > 0
    );

    // Prefer the field named "Priority Level" or similar planning-related priority
    // Fall back to any priority field with allowed values
    const priorityField =
      priorityFields.find((f) => f.name.toLowerCase().includes('priority level')) ||
      priorityFields.find((f) => f.referenceName !== 'Microsoft.VSTS.Common.Priority') ||
      priorityFields.find((f) => f.referenceName === 'Microsoft.VSTS.Common.Priority');

    if (!priorityField) {
      return NextResponse.json({ hasPriority: false, priorities: [], fieldReferenceName: null });
    }

    const allowedValues = priorityField.allowedValues || [];

    return NextResponse.json({
      hasPriority: true,
      fieldReferenceName: priorityField.referenceName,
      fieldName: priorityField.name,
      priorities: allowedValues.map((value: string) => ({
        value,
        label: value,
      })),
    });
  } catch (error) {
    console.error('Error fetching priorities:', error);
    return NextResponse.json({ error: 'Failed to fetch priorities' }, { status: 500 });
  }
}
