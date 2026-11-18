import { resolveAllowedValues, type DevOpsField } from '@/lib/devops-fields';
import type { RequiredField } from '@/hooks/useWorkItemActions';

/**
 * Describe fields well enough to draw a control for each: an identity field
 * wants a people picker, a date a date input, a picklist a dropdown.
 *
 * Shared by the state-requirements lookup (#651) and the state route, which
 * describes the fields a refused move left empty so the board can ask for
 * them (#663). Two copies would drift, and the dialog would then draw the
 * same field two different ways depending on which path found it.
 *
 * A field whose definition cannot be read is still returned, by reference
 * name, as text: asking for it plainly beats not asking at all.
 */

const UPSTREAM_TIMEOUT_MS = 10_000;

export async function describeFields(
  referenceNames: string[],
  context: {
    organization: string;
    project: string;
    workItemType: string;
    authHeaders: Record<string, string>;
  }
): Promise<RequiredField[]> {
  const { organization, project, workItemType, authHeaders } = context;
  const org = encodeURIComponent(organization);
  return Promise.all(
    referenceNames.map(async (referenceName) => {
      let definition: (DevOpsField & { isIdentity?: boolean; picklistId?: string | null }) | null =
        null;
      try {
        const response = await fetch(
          `https://dev.azure.com/${org}/_apis/wit/fields/${encodeURIComponent(referenceName)}?api-version=7.0`,
          { headers: authHeaders, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }
        );
        if (response.ok) definition = await response.json();
      } catch {
        // Described by name below.
      }
      const allowedValues = definition
        ? await resolveAllowedValues(definition, organization, project, workItemType, authHeaders)
        : [];
      return {
        referenceName,
        name: definition?.name || referenceName,
        type: definition?.type || 'string',
        isIdentity: definition?.isIdentity === true,
        allowedValues: allowedValues.length > 0 ? allowedValues : undefined,
      };
    })
  );
}
