import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import {
  NOT_APPROVED_PATH,
  isOpenPath,
  isPublicFile,
  isTenantApproved,
} from '@/lib/tenant-approval';

/**
 * Approved organisations only (see src/lib/tenant-approval.ts).
 *
 * Someone signed in from a tenant that is not approved gets 403 from every
 * protected API route and is sent to `/not-approved` from every page; the
 * sign-in, install and webhook paths in `isOpenPath` stay open. Signed-out requests
 * pass through unchanged: pages and routes already handle those (401, or the
 * sign-in page).
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Real static files only (/public and the app icons). Anything else that
  // merely ends in a file name, such as /tickets/42.png, is still checked.
  if (isPublicFile(pathname)) {
    return NextResponse.next();
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  const approved = token ? isTenantApproved(token.tenantId) : null;

  // An approved person has no business on the "not set up yet" page
  if (approved === true && pathname === NOT_APPROVED_PATH) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  if (approved !== false || isOpenPath(pathname)) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'Your organisation is not approved to use ZapDesk' },
      { status: 403 }
    );
  }
  return NextResponse.redirect(new URL(NOT_APPROVED_PATH, request.url));
}

export const config = {
  // Everything except Next's own build assets
  matcher: ['/((?!_next/static|_next/image).*)'],
};
