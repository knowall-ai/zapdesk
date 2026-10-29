import type { Session } from 'next-auth';
import { getToken } from 'next-auth/jwt';
import type { JWT } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';
import { cookies, headers } from 'next/headers';
import { authOptions } from '@/lib/auth';

/** NextAuth's own default when `session.maxAge` is not configured. */
const DEFAULT_SESSION_MAX_AGE = 30 * 24 * 60 * 60;

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
 * The signed-in session, with the Azure DevOps access token.
 *
 * Returns `null` when nobody is signed in. Returns the session **without** a
 * token when the user's Entra tenant is not an approved organisation, which is
 * what keeps the #534 gate working: every caller tests the token before using
 * it, so an unapproved tenant still gets a 401 and no route can call Azure
 * DevOps on its behalf.
 *
 * This runs NextAuth's own `jwt` and `session` callbacks over the cookie rather
 * than calling `getServerSession`, which would run the `jwt` callback a second
 * time. That matters because the callback is what refreshes an expired access
 * token: two runs meant two refresh requests to Entra for one browser request,
 * and if the second failed after the first had succeeded the route was handed
 * no token at all despite a refresh having just worked. One run, one refresh,
 * one answer.
 */
export async function getServerSessionWithToken(): Promise<ServerSession | null> {
  // getToken's published type wants a NextRequest or a Node request, but the
  // only things it reads are `cookies` -- to find and reassemble the session
  // cookie, which NextAuth splits into numbered chunks once it outgrows 4kB, as
  // one holding an Azure access token does -- and `headers`, for a Bearer
  // fallback ZapDesk does not use. next/headers supplies both, and the cookie
  // store has the `getAll()` that NextAuth's SessionStore looks for.
  const request = {
    cookies: await cookies(),
    headers: await headers(),
  } as unknown as NextRequest;

  // Decodes and verifies the cookie, so an expired or tampered session is null
  // here rather than reaching a callback.
  const stored = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!stored) {
    return null;
  }

  // Refreshes the access token when it has expired, exactly as it does for the
  // browser's own session request. What the cookie holds may be stale; this is
  // the only thing that makes it current.
  const jwtCallback = authOptions.callbacks!.jwt!;
  const token = (await jwtCallback({
    token: stored,
  } as Parameters<typeof jwtCallback>[0])) as JWT | null;
  if (!token) {
    return null;
  }

  // The same shape NextAuth builds before handing it to the session callback,
  // so the callback is the single place that decides what a session carries and
  // the server cannot drift from what the browser is told. `user.id` is filled
  // in by the callback itself.
  const maxAge = authOptions.session?.maxAge ?? DEFAULT_SESSION_MAX_AGE;
  const base = {
    user: { id: '', name: token.name, email: token.email, image: token.picture },
    expires: new Date(Date.now() + maxAge * 1000).toISOString(),
  } as Session;

  const sessionCallback = authOptions.callbacks!.session!;
  const session = (await sessionCallback({
    session: base,
    token,
  } as Parameters<typeof sessionCallback>[0])) as ServerSession;

  // Approved organisations only -- see #534.
  if (!session.tenantApproved) {
    return session;
  }

  // A failed refresh leaves `error` on the token, which the session callback
  // passes on as `session.error` so the app can ask the person to sign in
  // again. Giving a route the dead token as well turns one clear failure into
  // two. A refresh that succeeds clears this, so a single bad refresh does not
  // lock the session out for good.
  if (token.error) {
    return session;
  }

  return { ...session, accessToken: token.accessToken };
}
