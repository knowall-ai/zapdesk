/**
 * Who may read or change one GitHub issue (#566).
 *
 * The issue endpoints are called with ZapDesk's own credential -- the GitHub
 * App installation, or the server token -- not the user's. So access cannot be
 * left to GitHub: it is decided here, by the same rule the list uses. A user
 * gets an issue only when its repository is mapped to a DevOps project they
 * can see in the selected organization.
 *
 * Reusing `getGitHubTickets` rather than re-deriving that rule is deliberate.
 * The mapping has corners -- an `owner/*` wildcard must not hand out a
 * repository that another project names, and project names match
 * case-insensitively -- and a second copy of it would be a second place for
 * the access check to be wrong. The issues are cached, so this is a lookup.
 *
 * Server-only.
 */

import { AzureDevOpsService } from '@/lib/devops';
import { validateOrganizationAccess } from '@/lib/devops-auth';
import { getGitHubTickets } from '@/lib/github-issues';
import { gitHubAvailable, gitHubSourceFor } from '@/lib/github-source';
import { parseIssueRef } from '@/lib/github-issue-detail';
import type { Ticket } from '@/types';

export interface IssueAccessGranted {
  ok: true;
  repo: string;
  number: number;
  /** The issue as the list already knows it: project, labels, assignee, status. */
  ticket: Ticket;
  /** The credential to call GitHub with for this repository. */
  token: string;
}

export interface IssueAccessDenied {
  ok: false;
  status: number;
  error: string;
}

export type IssueAccess = IssueAccessGranted | IssueAccessDenied;

/**
 * Resolve `ref` (`owner/repo#123`) for this request, or say why not.
 *
 * "Not mapped to a project you can see" is answered 404, not 403: whether a
 * repository exists is itself something the caller is not entitled to know.
 */
export async function resolveIssueAccess(
  ref: string | null,
  organization: string | null,
  accessToken: string
): Promise<IssueAccess> {
  if (!organization) {
    return { ok: false, status: 400, error: 'No organization specified' };
  }

  const parsed = ref ? parseIssueRef(ref) : null;
  if (!parsed) {
    return { ok: false, status: 400, error: 'Expected an issue reference like owner/repo#123' };
  }

  if (!gitHubAvailable()) {
    return { ok: false, status: 404, error: 'GitHub is not set up' };
  }

  const hasAccess = await validateOrganizationAccess(accessToken, organization);
  if (!hasAccess) {
    return { ok: false, status: 403, error: 'Access denied to the specified organization' };
  }

  const devops = new AzureDevOpsService(accessToken, organization);
  const projects = await devops.getProjects();
  const config = await gitHubSourceFor(organization, projects, accessToken);
  if (!config) {
    return { ok: false, status: 404, error: 'GitHub is not set up' };
  }

  const { tickets } = await getGitHubTickets(projects, organization, config);
  const wanted = `${parsed.repo}#${parsed.number}`.toLowerCase();
  const ticket = tickets.find((t) => t.sourceRef?.toLowerCase() === wanted);
  if (!ticket) {
    return { ok: false, status: 404, error: 'That issue is not one ZapDesk can show you' };
  }

  const token = config.credentialFor?.(parsed.repo)?.token ?? config.token;
  if (!token) {
    return {
      ok: false,
      status: 503,
      error: 'ZapDesk has no credential for that repository',
    };
  }

  return { ok: true, repo: parsed.repo, number: parsed.number, ticket, token };
}
