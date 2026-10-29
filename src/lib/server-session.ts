import { getServerSession } from 'next-auth';
import type { Session } from 'next-auth';
import { getToken } from 'next-auth/jwt';
import type { JWT } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';
import { cookies, headers } from 'next/headers';
import { authOptions } from '@/lib/auth';

/**
 * A session plus the Azure DevOps access token, for server use only.
 *
 * The token is not on `Session` itself because that object is served to the
 * browser at `/api/auth/session`, where any script on the page could read it
 * (#542). Keeping it on a separate type means a route has to come through this
 * module to get one, and nothing can put it back on the browser session by
 * accident.
 */
export interface ServerSession extends Session {
  accessToken?: string;
}

/**
 * The signed-in session, with the DevOps access token read from the encrypted
 * JWT cookie rather than from the session object.
 *
 * Returns `null` when nobody is signed in. Returns the session **without** a
 * token when the user's Entra tenant is not an approved organisation, which is
 * what keeps the #534 gate working: every caller tests the token before using
 * it, so an unapproved tenant still gets a 401 and no route can call Azure
 * DevOps on its behalf.
 */
export async function getServerSessionWithToken(): Promise<ServerSession | null> {
  const session = await getServerSession(authOptions);
  if (!session) {
    return null;
  }

  // Approved organisations only -- see #534. Reading the token for an
  // unapproved tenant would hand it to callers that only check truthiness.
  if (!session.tenantApproved) {
    return session;
  }

  // getToken's published type wants a NextRequest or a Node request, but the
  // only things it reads are `cookies` -- to find and reassemble the session
  // cookie, which NextAuth splits into numbered chunks once it outgrows 4kB,
  // as one holding an Azure access token does -- and `headers`, for a Bearer
  // fallback ZapDesk does not use. next/headers supplies both, and the cookie
  // store has the `getAll()` that NextAuth's SessionStore looks for. Casting
  // here is narrower than threading a NextRequest through fifty-odd route
  // handlers, several of which take no request argument at all.
  const request = {
    cookies: await cookies(),
    headers: await headers(),
  } as unknown as NextRequest;

  const stored = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!stored) {
    return session;
  }

  // getToken only decodes the cookie that arrived with the request, so what it
  // returns is the access token as the cookie was last written. If that token
  // has since expired, this is the expired one -- where the code this replaced,
  // which read the token inside the session callback, was handed the refreshed
  // token that getServerSession's jwt callback had just produced.
  //
  // Running the same callback here keeps that behaviour rather than
  // reimplementing it: it returns the token untouched while it is still valid,
  // and refreshes it when it is not.
  //
  // On a request that genuinely needs a refresh this runs the refresh a second
  // time, because getServerSession above has already run the callback once.
  // That is one extra token request to Entra, only on requests where the token
  // had expired. Handing a route the expired token instead costs it a 401 from
  // Azure DevOps, which is worse and harder to explain.
  const jwtCallback = authOptions.callbacks!.jwt!;
  const refreshed = (await jwtCallback({
    token: stored,
  } as Parameters<typeof jwtCallback>[0])) as JWT | null;

  // A failed refresh leaves `error` on the token, which the session callback
  // passes to the browser as `session.error` so the app can ask the person to
  // sign in again. Giving a route the dead token on top of that turns one clear
  // failure into two.
  if (!refreshed || refreshed.error) {
    return session;
  }

  return { ...session, accessToken: refreshed.accessToken };
}
