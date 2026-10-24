/**
 * Approved organisations only.
 *
 * Any Entra tenant can install ZapDesk (#457), but only organisations KnowAll
 * has approved can use it. Someone signed in from any other tenant sees the
 * "not set up yet" page and nothing else: their session carries no Azure
 * DevOps token, the proxy turns their API calls away with 403, and their pages
 * redirect to `/not-approved`.
 *
 * A tenant is approved when its id (the `tid` claim) is:
 * - the KnowAll tenant,
 * - the tenant running this ZapDesk (`AZURE_AD_TENANT_ID`), so a single-tenant
 *   install keeps working, or
 * - listed in `APPROVED_TENANT_IDS` (comma-separated GUIDs).
 *
 * A missing or malformed `tid` is never approved: there is no default tenant
 * to fall back to.
 */

/** KnowAll AI's own Entra tenant. Guests invited into it (B2B) sign in through it. */
export const KNOWALL_TENANT_ID = 'f36f6414-cb7d-4545-9cf2-7574f7b5c584';

/** Where an unapproved organisation is sent. */
export const NOT_APPROVED_PATH = '/not-approved';

/** The address people write to for access. */
export const ACCESS_REQUEST_EMAIL = 'hello@knowall.ai';

const TENANT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The tenant id in canonical (lowercase) form, or null when it is not a GUID. */
export function normalizeTenantId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  return TENANT_ID_PATTERN.test(id) ? id : null;
}

/** Every approved tenant id, lowercased. Read on each call so a setting change needs no rebuild. */
export function approvedTenantIds(): Set<string> {
  const ids = new Set<string>([KNOWALL_TENANT_ID]);
  const home = normalizeTenantId(process.env.AZURE_AD_TENANT_ID);
  if (home) ids.add(home);
  for (const entry of (process.env.APPROVED_TENANT_IDS || '').split(',')) {
    const id = normalizeTenantId(entry);
    if (id) ids.add(id);
  }
  return ids;
}

/** True only when `tenantId` is a GUID on the approved list. */
export function isTenantApproved(tenantId: unknown): boolean {
  const id = normalizeTenantId(tenantId);
  return id !== null && approvedTenantIds().has(id);
}

/**
 * A label for the signed-in organisation. Entra's tokens carry no tenant
 * name, so this is the domain of the person's sign-in address.
 */
export function organisationLabel(email: string | null | undefined): string | null {
  const domain = email?.split('@')[1]?.trim().toLowerCase();
  return domain || null;
}

/** The pre-filled "Request access" email. */
export function accessRequestMailto({
  app,
  organisation,
  tenantId,
  email,
}: {
  app: string;
  organisation?: string | null;
  tenantId?: string | null;
  email?: string | null;
}): string {
  const body = [
    `Hello KnowAll,`,
    ``,
    `Please approve our organisation for ${app}.`,
    ``,
    `App: ${app}`,
    `Organisation: ${organisation || 'unknown'}`,
    `Tenant ID: ${tenantId || 'unknown'}`,
    `Email: ${email || 'unknown'}`,
  ].join('\n');
  const params = [
    `subject=${encodeURIComponent(`${app} access request`)}`,
    `body=${encodeURIComponent(body)}`,
  ].join('&');
  return `mailto:${ACCESS_REQUEST_EMAIL}?${params}`;
}

/**
 * Paths an unapproved person may still reach: sign-in and sign-out, the
 * install flow, this page itself, and server-to-server endpoints that
 * authenticate with their own secret rather than a session.
 */
const OPEN_PATHS = [
  NOT_APPROVED_PATH,
  '/login',
  '/install',
  '/api/auth',
  '/api/install',
  '/api/email',
  '/api/github/webhook',
];

export function isOpenPath(pathname: string): boolean {
  return OPEN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export type NotApprovedView =
  | { redirect: string }
  | {
      redirect?: undefined;
      signedIn: boolean;
      installed: boolean;
      organisation: string | null;
      tenantId: string | null;
      email: string | null;
    };

/**
 * What `/not-approved` shows. A signed-in, unapproved person sees their own
 * organisation; an admin straight back from installing sees the tenant they
 * installed for (the id is shown, never trusted). Anyone approved goes to the
 * app, and anyone else to sign-in.
 */
export function notApprovedView(
  session: {
    tenantId?: string;
    tenantApproved?: boolean;
    user?: { email?: string | null };
  } | null,
  params: { installed?: string; tenant?: string }
): NotApprovedView {
  if (session) {
    if (session.tenantApproved !== false) return { redirect: '/' };
    const email = session.user?.email ?? null;
    return {
      signedIn: true,
      installed: params.installed === '1',
      organisation: organisationLabel(email),
      tenantId: normalizeTenantId(session.tenantId),
      email,
    };
  }

  const tenantId = normalizeTenantId(params.tenant);
  if (params.installed === '1' && tenantId) {
    return {
      signedIn: false,
      installed: true,
      organisation: null,
      tenantId,
      email: null,
    };
  }
  return { redirect: '/login' };
}
