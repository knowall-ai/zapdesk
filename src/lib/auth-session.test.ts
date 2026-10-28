import { describe, expect, it } from 'vitest';
import type { Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import { authOptions } from './auth';
import { KNOWALL_TENANT_ID } from './tenant-approval';

/**
 * The session object is what NextAuth serves to the browser at
 * /api/auth/session, so anything copied onto it is readable by any script on
 * the page. The Azure DevOps refresh token must never get there (#540).
 */
describe('session callback', () => {
  async function buildSession(token: JWT): Promise<Session> {
    const session = authOptions.callbacks!.session!;
    return (await session({
      session: { user: { id: '' }, expires: '2099-01-01T00:00:00.000Z' } as Session,
      token,
      user: { id: 'user-1', email: '', emailVerified: null },
      newSession: undefined,
      trigger: 'update',
    })) as Session;
  }

  it('never exposes the refresh token to the browser', async () => {
    const session = await buildSession({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessTokenExpires: Date.now() + 60_000,
      id: 'user-1',
      tenantId: KNOWALL_TENANT_ID,
    });

    expect(session).not.toHaveProperty('refreshToken');
    expect(JSON.stringify(session)).not.toContain('refresh-token');
  });

  it('still carries the fields the app reads', async () => {
    const session = await buildSession({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      id: 'user-1',
      picture: 'https://example.test/avatar.png',
      tenantId: KNOWALL_TENANT_ID,
      error: 'RefreshAccessTokenError',
    });

    expect(session.accessToken).toBe('access-token');
    expect(session.error).toBe('RefreshAccessTokenError');
    expect(session.user.id).toBe('user-1');
    expect(session.user.image).toBe('https://example.test/avatar.png');
    expect(session.tenantId).toBe(KNOWALL_TENANT_ID);
  });

  it('exposes neither token when the organisation is not approved', async () => {
    const session = await buildSession({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      id: 'user-1',
      tenantId: 'not-a-tenant-guid',
    });

    expect(session.tenantApproved).toBe(false);
    expect(session.accessToken).toBeUndefined();
    expect(JSON.stringify(session)).not.toContain('refresh-token');
  });
});
