/**
 * "Install for my organisation" (#457).
 *
 * An admin of another Entra tenant grants ZapDesk's permissions once, through
 * Microsoft's admin-consent page. Entra then creates a ZapDesk service
 * principal in their tenant, and their people can sign in. Nothing is stored
 * by ZapDesk: the consent itself lives in the customer's tenant.
 */

import { randomBytes, timingSafeEqual } from 'crypto';

/** Cookie holding the state sent to Microsoft, checked when the admin comes back. */
export const INSTALL_STATE_COOKIE = 'zapdesk_install_state';
/** How long an admin has to finish the consent page. */
export const INSTALL_STATE_MAX_AGE_S = 10 * 60;

const TENANT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The public base URL ZapDesk is served from, without a trailing slash. */
export function appBaseUrl(): string {
  return (process.env.NEXTAUTH_URL || process.env.APP_URL || 'http://localhost:3000').replace(
    /\/+$/,
    ''
  );
}

/** Where Microsoft sends the admin back to; must be a redirect URI of the app registration. */
export function installCallbackUrl(): string {
  return `${appBaseUrl()}/api/install/callback`;
}

/** A fresh, unguessable state value. */
export function newInstallState(): string {
  return randomBytes(24).toString('hex');
}

/**
 * Microsoft's admin-consent page for this app. It grants every permission the
 * app registration lists, for the admin's whole tenant.
 */
export function adminConsentUrl(state: string): string {
  const url = new URL('https://login.microsoftonline.com/organizations/adminconsent');
  url.searchParams.set('client_id', process.env.AZURE_AD_CLIENT_ID || '');
  url.searchParams.set('redirect_uri', installCallbackUrl());
  url.searchParams.set('state', state);
  return url.toString();
}

/** True when the state Microsoft returned is the one this browser was given. */
export function installStateMatches(
  returned: string | null,
  expected: string | undefined
): boolean {
  if (!returned || !expected) return false;
  const a = Buffer.from(returned);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type InstallResult =
  | { ok: true; tenant: string }
  | { ok: false; reason: 'state' | 'declined' | 'failed'; detail?: string };

/** Read the parameters Microsoft returns to the callback. */
export function readInstallCallback(
  params: URLSearchParams,
  expectedState: string | undefined
): InstallResult {
  if (!installStateMatches(params.get('state'), expectedState)) {
    return { ok: false, reason: 'state' };
  }

  const error = params.get('error');
  if (error) {
    // Keep the AADSTS code, which is what an admin can look up; drop the rest
    const code = (params.get('error_description') || '').match(/AADSTS\d+/)?.[0];
    return {
      ok: false,
      reason: error === 'access_denied' ? 'declined' : 'failed',
      detail: code || error,
    };
  }

  const tenant = params.get('tenant') || '';
  if (params.get('admin_consent')?.toLowerCase() !== 'true' || !TENANT_ID_PATTERN.test(tenant)) {
    return { ok: false, reason: 'failed' };
  }
  return { ok: true, tenant };
}
