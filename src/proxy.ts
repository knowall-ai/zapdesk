import { NextResponse, type NextRequest } from 'next/server';
import { buildPageCsp } from '@/lib/security-headers';

/**
 * Per-request nonce CSP, following the Next 16 CSP guide. Next reads the
 * nonce from the request's Content-Security-Policy header (nothing else is
 * needed) and stamps it on its own scripts; the root layout opts into dynamic
 * rendering so every page gets a fresh one.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildPageCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: API routes get a fixed `default-src 'none'` policy from
      // next.config.ts, and static files need no CSP.
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
