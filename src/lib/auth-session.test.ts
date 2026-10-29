import { describe, expect, it } from 'vitest';
import type { Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import { authOptions } from './auth';
import { KNOWALL_TENANT_ID } from './tenant-approval';

/**
 * The session object is what NextAuth serves to the browser at
 * /api/auth/session, so anything copied onto it is readable by any script on
 * the page. Neither Azure DevOps token may get there: the refresh token per
 * #540, the access token per #542.
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

  it('never exposes either token to the browser', async () => {
    const session = await buildSession({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessTokenExpires: Date.now() + 60_000,
      id: 'user-1',
      tenantId: KNOWALL_TENANT_ID,
    });

    expect(session).not.toHaveProperty('refreshToken');
    expect(session).not.toHaveProperty('accessToken');

    // Checked on the serialised object as well as the fields, because this is
    // exactly what /api/auth/session sends: a token reachable by any path
    // through it is reachable by a script on the page.
    const served = JSON.stringify(session);
    expect(served).not.toContain('refresh-token');
    expect(served).not.toContain('access-token');
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

    expect(session.hasDevOpsToken).toBe(true);
    expect(session.error).toBe('RefreshAccessTokenError');
    expect(session.user.id).toBe('user-1');
    expect(session.user.image).toBe('https://example.test/avatar.png');
    expect(session.tenantId).toBe(KNOWALL_TENANT_ID);
  });

  it('reports no DevOps token when the organisation is not approved', async () => {
    const session = await buildSession({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      id: 'user-1',
      tenantId: 'not-a-tenant-guid',
    });

    expect(session.tenantApproved).toBe(false);
    expect(session.hasDevOpsToken).toBe(false);
    expect(JSON.stringify(session)).not.toContain('refresh-token');
  });

  it('reports no DevOps token when an approved organisation has none', async () => {
    const session = await buildSession({
      id: 'user-1',
      tenantId: KNOWALL_TENANT_ID,
    });

    expect(session.tenantApproved).toBe(true);
    expect(session.hasDevOpsToken).toBe(false);
  });

  it('falls back to the sub claim for the user id', async () => {
    // TicketCountsProvider scopes cached counts on this id. It used to tell two
    // id-less accounts apart by their differing access tokens, which #542 took
    // off the session, so the id has to stand on its own now.
    const session = await buildSession({
      sub: 'subject-claim',
      tenantId: KNOWALL_TENANT_ID,
    });

    expect(session.user.id).toBe('subject-claim');
  });
});
