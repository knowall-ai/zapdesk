import { NextRequest, NextResponse } from 'next/server';
import { getServerSessionWithToken } from '@/lib/server-session';
import { validateOrganizationAccess } from '@/lib/devops-auth';
import { parseWorkItemId } from '@/lib/work-item-id';
import { resolveAllowedValues, type DevOpsField } from '@/lib/devops-fields';
import {
  fieldHasValue,
  requiredFieldsForTransition,
  type ProcessRule,
} from '@/lib/state-transition-rules';

/**
 * GET /api/devops/tickets/[id]/state-requirements?to=Todo&project=...
 *
 * What a state change will require before it is offered (#651). A process can
 * make a field required only on certain transitions -- "any state other than
 * New requires Approved By and Approved Date" -- and ZapDesk sent only the
 * state, so the rule rejected the update and the ticket stayed put.
 *
 * `required-fields` cannot answer this: it reads the work item type's
 * unconditional `required`/`alwaysRequired` flags, and a transition rule is
 * in neither.
 *
 * Answers `{ fields: [...] }`, empty when the transition needs nothing extra.
 * `{ unavailable: true }` means the process rules could not be read -- they
 * need a permission an ordinary user may not have -- in which case the caller
 * should go ahead and let the server's own error speak, rather than block a
 * transition that may well be allowed.
 */
/**
 * How long each lookup here may take. The dialog waits on this answer before
 * it will offer the transition, so an upstream call that never returns would
 * leave the user looking at a dropdown that does nothing. `devops.ts` bounds
 * its own calls the same way (raised in review on #652).
 */
const UPSTREAM_TIMEOUT_MS = 10_000;

/** A GET that cannot hang, so the fallbacks below are reached in bounded time. */
function bounded(url: string, headers: HeadersInit): Promise<Response> {
  return fetch(url, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSessionWithToken();
    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const ticketId = parseWorkItemId(id);
    if (ticketId === null) {
      return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 });
    }

    const to = (request.nextUrl.searchParams.get('to') || '').trim();
    if (!to) {
      return NextResponse.json({ error: 'A target state is required' }, { status: 400 });
    }
    const project = (request.nextUrl.searchParams.get('project') || '').trim();
    if (!project) {
      return NextResponse.json({ error: 'A project is required' }, { status: 400 });
    }

    const organization = request.headers.get('x-devops-org');
    if (!organization) {
      return NextResponse.json({ error: 'No organization specified' }, { status: 400 });
    }
    if (!(await validateOrganizationAccess(session.accessToken, organization))) {
      return NextResponse.json({ error: 'Access denied to the organization' }, { status: 403 });
    }

    const authHeaders = {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    };
    const org = encodeURIComponent(organization);
    const proj = encodeURIComponent(project);

    // The item itself: the state it is really in, its type, and which of the
    // required fields it already holds. Taking `from` from the server rather
    // than the caller keeps the answer honest if the board is stale.
    const itemResponse = await bounded(
      `https://dev.azure.com/${org}/${proj}/_apis/wit/workitems/${ticketId}?api-version=7.0`,
      authHeaders
    );
    if (!itemResponse.ok) {
      return NextResponse.json({ fields: [], unavailable: true });
    }
    const item = (await itemResponse.json()) as { fields?: Record<string, unknown> };
    const from = String(item.fields?.['System.State'] ?? '');
    const typeName = String(item.fields?.['System.WorkItemType'] ?? '');
    if (!typeName) return NextResponse.json({ fields: [] });
    // Nothing to require of a state the item is already in.
    if (from === to) return NextResponse.json({ fields: [] });

    // Project -> process. The properties endpoint takes the project's id and
    // answers 400 to its name, so the name has to be resolved first.
    const projectResponse = await bounded(
      `https://dev.azure.com/${org}/_apis/projects/${proj}?api-version=7.0`,
      authHeaders
    );
    if (!projectResponse.ok) return NextResponse.json({ fields: [], unavailable: true });
    const projectId = ((await projectResponse.json()) as { id?: string }).id;
    if (!projectId) return NextResponse.json({ fields: [], unavailable: true });

    // `System.ProcessTemplateType` is the inherited process. `System.Process
    // Template` names the base template it was derived from ("Scrum"), which
    // is not the process whose rules apply.
    const propsResponse = await bounded(
      `https://dev.azure.com/${org}/_apis/projects/${encodeURIComponent(projectId)}/properties?api-version=7.0-preview.1`,
      authHeaders
    );
    if (!propsResponse.ok) return NextResponse.json({ fields: [], unavailable: true });
    const props = (await propsResponse.json()) as {
      value?: { name?: string; value?: string }[];
    };
    const processId = props.value?.find((p) => p.name === 'System.ProcessTemplateType')?.value;
    if (!processId) return NextResponse.json({ fields: [], unavailable: true });

    // The rules endpoint takes the type's reference name, while the work item
    // carries its display name.
    const typesResponse = await bounded(
      `https://dev.azure.com/${org}/_apis/work/processes/${processId}/workitemtypes?api-version=7.0`,
      authHeaders
    );
    if (!typesResponse.ok) return NextResponse.json({ fields: [], unavailable: true });
    const types = (await typesResponse.json()) as {
      value?: { name?: string; referenceName?: string }[];
    };
    const referenceName = types.value?.find((t) => t.name === typeName)?.referenceName;
    if (!referenceName) return NextResponse.json({ fields: [], unavailable: true });

    const rulesResponse = await bounded(
      `https://dev.azure.com/${org}/_apis/work/processes/${processId}/workItemTypes/${encodeURIComponent(referenceName)}/rules?api-version=7.0`,
      authHeaders
    );
    if (!rulesResponse.ok) {
      // Most likely a permission the user does not have. Say so rather than
      // claiming the transition needs nothing.
      return NextResponse.json({ fields: [], unavailable: true });
    }
    const rules = (await rulesResponse.json()) as { value?: ProcessRule[] };

    const needed = requiredFieldsForTransition(rules.value ?? [], from, to, (field) =>
      fieldHasValue(item.fields, field)
    );
    if (needed.length === 0) return NextResponse.json({ fields: [] });

    // Describe each one well enough to draw a control for it: an identity
    // field wants a people picker, a date wants a date input.
    const fields = await Promise.all(
      needed.map(async (referenceNameOfField) => {
        const fieldResponse = await bounded(
          `https://dev.azure.com/${org}/_apis/wit/fields/${encodeURIComponent(referenceNameOfField)}?api-version=7.0`,
          authHeaders
        );
        const definition = fieldResponse.ok
          ? ((await fieldResponse.json()) as DevOpsField & {
              isIdentity?: boolean;
              picklistId?: string | null;
            })
          : null;
        const allowedValues = definition
          ? await resolveAllowedValues(definition, organization, project, typeName, authHeaders)
          : [];
        return {
          referenceName: referenceNameOfField,
          name: definition?.name || referenceNameOfField,
          type: definition?.type || 'string',
          isIdentity: definition?.isIdentity === true,
          allowedValues: allowedValues.length > 0 ? allowedValues : undefined,
        };
      })
    );

    return NextResponse.json({ fields });
  } catch (error) {
    console.error('Error reading state requirements:', error);
    // Not a failure the caller should be blocked by: let the transition be
    // attempted and report whatever the server says about it.
    return NextResponse.json({ fields: [], unavailable: true });
  }
}
