import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session } from 'next-auth';

/**
 * The access token is no longer on the session served to the browser (#542),
 * so server code reads it from the encrypted JWT cookie through this module.
 * What matters here is that moving the read did not widen who gets a token:
 * an unapproved organisation must still come back without one.
 */

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: () => getServerSession() }));

const getToken = vi.fn();
vi.mock('next-auth/jwt', () => ({ getToken: (...args: unknown[]) => getToken(...args) }));

const cookieStore = { getAll: () => [{ name: 'next-auth.session-token', value: 'chunk' }] };
vi.mock('next/headers', () => ({
  cookies: async () => cookieStore,
  headers: async () => new Headers(),
}));

vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const approved = (over: Partial<Session> = {}): Session =>
  ({
    user: { id: 'u1' },
    expires: '2099-01-01T00:00:00.000Z',
    tenantApproved: true,
    hasDevOpsToken: true,
    ...over,
  }) as Session;

beforeEach(() => {
  vi.clearAllMocks();
  getToken.mockResolvedValue({ accessToken: 'devops-token' });
});

describe('getServerSessionWithToken', () => {
  it('returns null when nobody is signed in', async () => {
    getServerSession.mockResolvedValue(null);
    const { getServerSessionWithToken } = await import('./server-session');

    expect(await getServerSessionWithToken()).toBeNull();
    // No point reading a cookie for a request that has no session.
    expect(getToken).not.toHaveBeenCalled();
  });

  it('attaches the token for an approved organisation', async () => {
    getServerSession.mockResolvedValue(approved());
    const { getServerSessionWithToken } = await import('./server-session');

    const session = await getServerSessionWithToken();
    expect(session?.accessToken).toBe('devops-token');
  });

  it('withholds the token from an unapproved organisation', async () => {
    getServerSession.mockResolvedValue(approved({ tenantApproved: false, hasDevOpsToken: false }));
    const { getServerSessionWithToken } = await import('./server-session');

    const session = await getServerSessionWithToken();
    // Every caller tests the token before using it, so this is what keeps the
    // #534 gate working now that the read moved off the session object.
    expect(session?.accessToken).toBeUndefined();
    expect(getToken).not.toHaveBeenCalled();
  });

  it('reads the cookie store, which is what reassembles a chunked cookie', async () => {
    getServerSession.mockResolvedValue(approved());
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
