/**
 * Which Azure DevOps organization a request is for (#457).
 *
 * The organization the user picked in the header is sent as `x-devops-org`.
 * `AZURE_DEVOPS_ORG` is only a server default for requests that do not say,
 * such as email ingest. There is no built-in default: a ZapDesk installed for
 * another company must never fall back to someone else's organization.
 */

/** The server's default Azure DevOps organization, or null when none is set. */
export function configuredDevOpsOrg(): string | null {
  return (process.env.AZURE_DEVOPS_ORG || '').trim() || null;
}

/** The organization a request names in `x-devops-org`, else the server default. */
export function requestDevOpsOrg(request: Request): string | null {
  return (request.headers.get('x-devops-org') || '').trim() || configuredDevOpsOrg();
}

/** Thrown when neither the request nor the server says which organization to use. */
export class MissingDevOpsOrgError extends Error {
  constructor() {
    super('No Azure DevOps organization selected. Choose one, or set AZURE_DEVOPS_ORG.');
    this.name = 'MissingDevOpsOrgError';
  }
}

/** The given organization, else the server default; throws when there is neither. */
export function devOpsOrgOrDefault(organization?: string | null): string {
  const org = (organization || '').trim() || configuredDevOpsOrg();
  if (!org) throw new MissingDevOpsOrgError();
  return org;
}
