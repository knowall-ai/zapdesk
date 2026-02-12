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

    // Prefer custom "PriorityLevel" (Planning) over generic "Priority" (Effort)
    const candidateField =
      priorityFields.find((f) => f.name.toLowerCase().includes('prioritylevel')) ||
      priorityFields.find((f) => f.name.toLowerCase().includes('priority level')) ||
      priorityFields.find((f) => f.referenceName !== 'Microsoft.VSTS.Common.Priority') ||
      priorityFields.find((f) => f.referenceName === 'Microsoft.VSTS.Common.Priority');

    if (!candidateField) {
      return NextResponse.json({ hasPriority: false, priorities: [], fieldReferenceName: null });
    }

    // Try multiple approaches to get allowed values
    let allowedValues: string[] = candidateField.allowedValues || [];

    // Approach 1: Fetch the specific field from work item type definition
    if (allowedValues.length === 0) {
      const fieldResponse = await fetch(
        `https://dev.azure.com/${organization}/${encodeURIComponent(projectName)}/_apis/wit/workitemtypes/${encodeURIComponent(workItemType)}/fields/${encodeURIComponent(candidateField.referenceName)}?api-version=7.0`,
        { headers: authHeaders }
      );

      if (fieldResponse.ok) {
        const fieldData = await fieldResponse.json();
        allowedValues = fieldData.allowedValues || [];
      }
    }

    // Approach 2: For custom picklist fields, fetch from the global fields API
    if (allowedValues.length === 0) {
      const globalFieldResponse = await fetch(
        `https://dev.azure.com/${organization}/_apis/wit/fields/${encodeURIComponent(candidateField.referenceName)}?api-version=7.0`,
        { headers: authHeaders }
      );

      if (globalFieldResponse.ok) {
        const globalFieldData = await globalFieldResponse.json();

        // If it's a picklist field, get the picklist ID and fetch values
        if (globalFieldData.isPicklist && globalFieldData.picklistId) {
          const picklistResponse = await fetch(
            `https://dev.azure.com/${organization}/_apis/work/processes/lists/${globalFieldData.picklistId}?api-version=7.0`,
            { headers: authHeaders }
          );

          if (picklistResponse.ok) {
            const picklistData = await picklistResponse.json();
            allowedValues = (picklistData.items || []).map((item: string) => item);
          }
        }
      }
    }

    // Approach 3: Fetch via process template API
    if (allowedValues.length === 0) {
      // Get project properties to find the process template
      const projectResponse = await fetch(
        `https://dev.azure.com/${organization}/_apis/projects/${encodeURIComponent(projectName)}/properties?api-version=7.0-preview.1`,
        { headers: authHeaders }
      );

      if (projectResponse.ok) {
        const projectData = await projectResponse.json();
        const processId = (projectData.value || []).find(
          (p: { name: string }) => p.name === 'System.ProcessTemplateType'
        )?.value;

        if (processId) {
          // Fetch the work item type definition from the process
          const processWitResponse = await fetch(
            `https://dev.azure.com/${organization}/_apis/work/processes/${processId}/workItemTypes?api-version=7.0`,
            { headers: authHeaders }
          );

          if (processWitResponse.ok) {
            const processWitData = await processWitResponse.json();
            const witDef = (processWitData.value || []).find(
              (w: { name: string }) => w.name === workItemType
            );

            if (witDef?.referenceName) {
              // Fetch fields for this work item type in the process
              const processFieldsResponse = await fetch(
                `https://dev.azure.com/${organization}/_apis/work/processes/${processId}/workItemTypes/${encodeURIComponent(witDef.referenceName)}/fields?api-version=7.0`,
                { headers: authHeaders }
              );

              if (processFieldsResponse.ok) {
                const processFieldsData = await processFieldsResponse.json();
                const targetField = (processFieldsData.value || []).find(
                  (f: { referenceName: string }) => f.referenceName === candidateField.referenceName
                );

                if (targetField?.allowedValues) {
                  allowedValues = targetField.allowedValues;
                }
              }
            }
          }
        }
      }
    }

    if (allowedValues.length === 0) {
      // Still show the field but without predefined options — user can't select
      return NextResponse.json({ hasPriority: false, priorities: [], fieldReferenceName: null });
    }

    return NextResponse.json({
      hasPriority: true,
      fieldReferenceName: candidateField.referenceName,
      fieldName: candidateField.name,
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
