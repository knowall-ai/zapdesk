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

/**
 * An Azure DevOps organization name: letters, digits and hyphens, starting
 * and ending with a letter or digit, at most 50 characters. Anything else is
 * not one, and must not reach a dev.azure.com URL.
 */
const DEVOPS_ORG_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,48}[A-Za-z0-9])?$/;

/**
 * The organization an image request is for: `x-devops-org` if sent, else an
 * `?org=` in the URL, else the server default.
 *
 * An `<img>` cannot send a header, so a generated avatar URL names its
 * organization in the query instead (#674 review). The name is checked
 * before use; the image is still fetched with the user's own token, so it
 * reaches nothing the user cannot already see.
 */
export function imageRequestDevOpsOrg(request: Request): string | null {
  const header = (request.headers.get('x-devops-org') || '').trim();
  if (header) return header;
  const query = (new URL(request.url).searchParams.get('org') || '').trim();
  if (query && DEVOPS_ORG_NAME.test(query)) return query;
  return configuredDevOpsOrg();
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
