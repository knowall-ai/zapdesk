export interface DevOpsField {
  referenceName: string;
  name: string;
  allowedValues?: string[];
  type?: string;
  required?: boolean;
}

/** Try to resolve allowed values for a single field using multiple DevOps APIs */
export async function resolveAllowedValues(
  field: DevOpsField,
  organization: string,
  projectName: string,
  workItemType: string,
  authHeaders: Record<string, string>
): Promise<string[]> {
  // Check inline allowed values first
  if (field.allowedValues && field.allowedValues.length > 0) {
    return field.allowedValues;
  }

  // Approach 1: Fetch the specific field from work item type definition
  try {
    const fieldResponse = await fetch(
      `https://dev.azure.com/${organization}/${encodeURIComponent(projectName)}/_apis/wit/workitemtypes/${encodeURIComponent(workItemType)}/fields/${encodeURIComponent(field.referenceName)}?api-version=7.0`,
      { headers: authHeaders }
    );

    if (fieldResponse.ok) {
      const fieldData = await fieldResponse.json();
      if (fieldData.allowedValues?.length > 0) {
        return fieldData.allowedValues;
      }
    }
  } catch {
    // Continue to next approach
  }

  // Approach 2: For custom picklist fields, fetch from the global fields API
  try {
    const globalFieldResponse = await fetch(
      `https://dev.azure.com/${organization}/_apis/wit/fields/${encodeURIComponent(field.referenceName)}?api-version=7.0`,
      { headers: authHeaders }
    );

    if (globalFieldResponse.ok) {
      const globalFieldData = await globalFieldResponse.json();

      if (globalFieldData.isPicklist && globalFieldData.picklistId) {
        const picklistResponse = await fetch(
          `https://dev.azure.com/${organization}/_apis/work/processes/lists/${globalFieldData.picklistId}?api-version=7.0`,
          { headers: authHeaders }
        );

        if (picklistResponse.ok) {
          const picklistData = await picklistResponse.json();
          const items = (picklistData.items || []).map((item: string) => item);
          if (items.length > 0) return items;
        }
      }
    }
  } catch {
    // Continue to next approach
  }

  // Approach 3: Fetch via process template API
  try {
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
            const processFieldsResponse = await fetch(
              `https://dev.azure.com/${organization}/_apis/work/processes/${processId}/workItemTypes/${encodeURIComponent(witDef.referenceName)}/fields?api-version=7.0`,
              { headers: authHeaders }
            );

            if (processFieldsResponse.ok) {
              const processFieldsData = await processFieldsResponse.json();
              const targetField = (processFieldsData.value || []).find(
                (f: { referenceName: string }) => f.referenceName === field.referenceName
              );

              if (targetField?.allowedValues?.length > 0) {
                return targetField.allowedValues;
              }
            }
          }
        }
      }
    }
  } catch {
    // All approaches exhausted
  }

  return [];
}
