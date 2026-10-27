import { NextRequest, NextResponse } from 'next/server';
import { INSTALL_STATE_COOKIE, appBaseUrl, readInstallCallback } from '@/lib/install';
import { NOT_APPROVED_PATH, isTenantApproved } from '@/lib/tenant-approval';

/**
 * GET /api/install/callback - Where Microsoft returns the admin after the
 * consent page (#457). Shows the outcome on /install; nothing is stored.
 *
 * Installing is open to any organisation, but using ZapDesk is not: a tenant
 * KnowAll has not approved lands on the "installed, pending approval" page
 * instead of being invited to sign in.
 */
export async function GET(request: NextRequest) {
  const result = readInstallCallback(
    request.nextUrl.searchParams,
    request.cookies.get(INSTALL_STATE_COOKIE)?.value
  );

  let target = new URL(`${appBaseUrl()}/install`);
  if (result.ok && !isTenantApproved(result.tenant)) {
    target = new URL(`${appBaseUrl()}${NOT_APPROVED_PATH}`);
    target.searchParams.set('installed', '1');
    target.searchParams.set('tenant', result.tenant);
  } else if (result.ok) {
    target.searchParams.set('result', 'installed');
  } else {
    target.searchParams.set('result', result.reason);
    if (result.detail) target.searchParams.set('detail', result.detail);
    console.warn('[Install] Admin consent did not complete:', result.reason, result.detail ?? '');
  }

  const response = NextResponse.redirect(target.toString());
  response.cookies.delete({ name: INSTALL_STATE_COOKIE, path: '/api/install' });
  return response;
}
