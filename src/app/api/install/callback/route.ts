import { NextRequest, NextResponse } from 'next/server';
import { INSTALL_STATE_COOKIE, appBaseUrl, readInstallCallback } from '@/lib/install';

/**
 * GET /api/install/callback - Where Microsoft returns the admin after the
 * consent page (#457). Shows the outcome on /install; nothing is stored.
 */
export async function GET(request: NextRequest) {
  const result = readInstallCallback(
    request.nextUrl.searchParams,
    request.cookies.get(INSTALL_STATE_COOKIE)?.value
  );

  const target = new URL(`${appBaseUrl()}/install`);
  if (result.ok) {
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
