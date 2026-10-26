import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { buildPageCsp } from '@/lib/security-headers';
import {
  NOT_APPROVED_PATH,
  isOpenPath,
  isPublicFile,
  isTenantApproved,
} from '@/lib/tenant-approval';

/**
 * Two jobs on every request, in this order:
 *
 * 1. Approved organisations only (see src/lib/tenant-approval.ts). Someone
 *    signed in from a tenant that is not approved gets 403 from every
 *    protected API route and is sent to `/not-approved` from every page; the
 *    sign-in, install and webhook paths in `isOpenPath` stay open. Signed-out
 *    requests pass through unchanged: pages and routes already handle those
 *    (401, or the sign-in page).
 * 2. A per-request nonce CSP on pages, following the Next 16 CSP guide. Next
 *    reads the nonce from the request's Content-Security-Policy header (nothing
 *    else is needed) and stamps it on its own scripts; the root layout opts into dynamic rendering so every page gets a
 *    fresh one. API routes get a fixed `default-src 'none'` policy from
 *    next.config.ts, prefetches don't render a document, and static files need
 *    no CSP.
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
    return withPageCsp(request);
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'Your organisation is not approved to use ZapDesk' },
      { status: 403 }
    );
  }
  return NextResponse.redirect(new URL(NOT_APPROVED_PATH, request.url));
}

const isPrefetch = (request: NextRequest) =>
  request.headers.has('next-router-prefetch') || request.headers.get('purpose') === 'prefetch';

/** Let the request through; a page (not an API route or a prefetch) gets a fresh nonce CSP. */
function withPageCsp(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/api/') || pathname === '/favicon.ico' || isPrefetch(request)) {
    return NextResponse.next();
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildPageCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Everything except Next's own build assets: the approval gate covers pages and API routes
  matcher: ['/((?!_next/static|_next/image).*)'],
};
