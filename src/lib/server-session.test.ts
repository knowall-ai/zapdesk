import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JWT } from 'next-auth/jwt';

/**
 * The access token is no longer on the session served to the browser (#542),
 * so server code reads it from the encrypted JWT cookie through this module.
 * Two things matter here. Moving the read must not widen who gets a token: an
 * unapproved organisation still comes back without one. And it must refresh an
 * expired token exactly once -- the callback that refreshes it used to run
 * twice per request, which meant two refresh calls to Entra and, if the second
 * failed after the first succeeded, no token at all.
 */

const getToken = vi.fn();
vi.mock('next-auth/jwt', () => ({ getToken: (...args: unknown[]) => getToken(...args) }));

const cookieStore = { getAll: () => [{ name: 'next-auth.session-token', value: 'chunk' }] };
vi.mock('next/headers', () => ({
  cookies: async () => cookieStore,
  headers: async () => new Headers(),
}));

const jwtCallback = vi.fn();
const sessionCallback = vi.fn();
vi.mock('@/lib/auth', () => ({
  authOptions: {
    session: { maxAge: 24 * 60 * 60 },
    callbacks: {
      jwt: (...args: unknown[]) => jwtCallback(...args),
      session: (...args: unknown[]) => sessionCallback(...args),
    },
  },
}));

/** A cookie holding a token that is still valid. */
const stored = (over: Partial<JWT> = {}): JWT =>
  ({ accessToken: 'devops-token', tenantId: 'tenant', id: 'u1', ...over }) as JWT;

beforeEach(() => {
  vi.clearAllMocks();
  getToken.mockResolvedValue(stored());
  // Stands in for a token that has not expired: handed straight back.
  jwtCallback.mockImplementation(async ({ token }: { token: JWT }) => token);
  // Stands in for the real callback, which approves the tenant and copies the
  // public fields across.
  sessionCallback.mockImplementation(
    async ({ session, token }: { session: object; token: JWT }) => ({
      ...session,
      tenantApproved: true,
      hasDevOpsToken: !!token.accessToken,
      error: token.error,
    })
  );
});

describe('getServerSessionWithToken', () => {
  it('returns null when there is no session cookie', async () => {
    getToken.mockResolvedValue(null);
    const { getServerSessionWithToken } = await import('./server-session');

    expect(await getServerSessionWithToken()).toBeNull();
    // Nothing to run a callback over.
    expect(jwtCallback).not.toHaveBeenCalled();
  });

  it('attaches the token for an approved organisation', async () => {
    const { getServerSessionWithToken } = await import('./server-session');

    const session = await getServerSessionWithToken();
    expect(session?.accessToken).toBe('devops-token');
  });

  it('withholds the token from an unapproved organisation', async () => {
    sessionCallback.mockResolvedValue({ tenantApproved: false, hasDevOpsToken: false });
    const { getServerSessionWithToken } = await import('./server-session');

    const session = await getServerSessionWithToken();
    // Every caller tests the token before using it, so this is what keeps the
    // #534 gate working now the read has moved off the session object.
    expect(session?.accessToken).toBeUndefined();
  });

  it('hands back the refreshed token, not the one the cookie held', async () => {
    // getToken reads the cookie as it arrived, so for an expired token this is
    // the expired one. The jwt callback is what makes it current.
    getToken.mockResolvedValue(stored({ accessToken: 'expired-token', accessTokenExpires: 1 }));
    jwtCallback.mockResolvedValue(stored({ accessToken: 'refreshed-token' }));

    const { getServerSessionWithToken } = await import('./server-session');
    const session = await getServerSessionWithToken();

    expect(session?.accessToken).toBe('refreshed-token');
  });

  it('refreshes once per request, not twice', async () => {
    getToken.mockResolvedValue(stored({ accessToken: 'expired-token', accessTokenExpires: 1 }));
    jwtCallback.mockResolvedValue(stored({ accessToken: 'refreshed-token' }));

    const { getServerSessionWithToken } = await import('./server-session');
    await getServerSessionWithToken();

    // Two runs meant two refresh requests to Entra for one browser request, and
    // if the second failed after the first had succeeded the route got nothing.
    // This is why the module does not call getServerSession, which would run
    // the callback again over the same cookie.
    expect(jwtCallback).toHaveBeenCalledTimes(1);
  });

  it('withholds the token when the refresh failed', async () => {
    getToken.mockResolvedValue(stored({ accessTokenExpires: 1 }));
    jwtCallback.mockResolvedValue({ error: 'RefreshAccessTokenError' } as JWT);

    const { getServerSessionWithToken } = await import('./server-session');
    const session = await getServerSessionWithToken();

    expect(session?.accessToken).toBeUndefined();
    expect(session?.error).toBe('RefreshAccessTokenError');
  });

  it('serves a token again once a refresh succeeds after an earlier failure', async () => {
    // The cookie can carry `error` from a refresh that failed before. A later
    // successful refresh clears it, so one bad refresh must not lock the
    // session out of DevOps for good.
    getToken.mockResolvedValue(stored({ error: 'RefreshAccessTokenError', accessTokenExpires: 1 }));
    jwtCallback.mockResolvedValue(stored({ accessToken: 'refreshed-token', error: undefined }));

    const { getServerSessionWithToken } = await import('./server-session');
    const session = await getServerSessionWithToken();

    expect(session?.accessToken).toBe('refreshed-token');
  });

  it('reads the cookie store, which is what reassembles a chunked cookie', async () => {
    const { getServerSessionWithToken } = await import('./server-session');
    await getServerSessionWithToken();

    // A session cookie holding an Azure access token outgrows 4kB and NextAuth
    // splits it into numbered chunks. Its SessionStore rejoins them, but only
    // when handed something with getAll() -- passing a plain object would read
    // an empty token and log everyone out.
    const [params] = getToken.mock.calls[0] as [{ req: { cookies: unknown } }];
    expect(params.req.cookies).toBe(cookieStore);
    expect(typeof (params.req.cookies as { getAll?: unknown }).getAll).toBe('function');
  });
});
