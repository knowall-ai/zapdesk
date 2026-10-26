import { NextResponse } from 'next/server';
import { isMultiTenant } from '@/lib/auth';
import {
  INSTALL_STATE_COOKIE,
  INSTALL_STATE_MAX_AGE_S,
  adminConsentUrl,
  appBaseUrl,
  newInstallState,
} from '@/lib/install';

/**
 * GET /api/install - Send an admin to Microsoft to install ZapDesk for their
 * organisation (#457). The state goes in a short-lived cookie, so the callback
 * only accepts an answer to a request this browser started.
 */
export async function GET() {
  if (!isMultiTenant() || !process.env.AZURE_AD_CLIENT_ID) {
    return NextResponse.redirect(`${appBaseUrl()}/install?result=unavailable`);
  }

  const state = newInstallState();
  const response = NextResponse.redirect(adminConsentUrl(state));
  response.cookies.set(INSTALL_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: appBaseUrl().startsWith('https://'),
    maxAge: INSTALL_STATE_MAX_AGE_S,
    path: '/api/install',
  });
  return response;
}
