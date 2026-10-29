import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { JWT } from 'next-auth/jwt';
import { authOptions } from './auth';

/**
 * The jwt callback's refresh path. Reached through the callback because
 * `refreshAccessToken` is private to the module, and the callback is how both
 * the browser's session request and the server accessor get there.
 */

const fetchMock = vi.fn();

async function runJwt(token: JWT): Promise<JWT> {
  const jwt = authOptions.callbacks!.jwt!;
  return (await jwt({ token } as Parameters<typeof jwt>[0])) as JWT;
}

/** A token whose access token expired a moment ago. */
const expired = (over: Partial<JWT> = {}): JWT =>
  ({
    accessToken: 'old-access-token',
    refreshToken: 'refresh-token',
    accessTokenExpires: Date.now() - 1_000,
    tenantId: '11111111-2222-4333-8444-555555555555',
    ...over,
  }) as JWT;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('AZURE_AD_CLIENT_ID', 'client-id');
  vi.stubEnv('AZURE_AD_CLIENT_SECRET', 'client-secret');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('refreshing an expired access token', () => {
  it('replaces the access token', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-access-token', expires_in: 3600 }),
    });

    const token = await runJwt(expired());

    expect(token.accessToken).toBe('new-access-token');
    expect(token.accessTokenExpires).toBeGreaterThan(Date.now());
  });

  it('clears an error recorded by an earlier failed refresh', async () => {
    // The cookie can carry `error` from a refresh that failed before. Spreading
    // the old token carried it through a refresh that had just succeeded, which
    // left the app asking the person to sign in again when nothing was wrong --
    // and, since #542, made the server accessor withhold a working token for
    // good, because it will not hand a route a token marked failed.
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-access-token', expires_in: 3600 }),
    });

    const token = await runJwt(expired({ error: 'RefreshAccessTokenError' }));

    expect(token.accessToken).toBe('new-access-token');
    expect(token.error).toBeUndefined();
  });

  it('records the failure when the refresh is refused', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'invalid_grant' }),
    });

    const token = await runJwt(expired());

    expect(token.error).toBe('RefreshAccessTokenError');
    // The old token is kept rather than blanked: the app reads `error` to ask
    // for a fresh sign-in, and the accessor refuses to serve a token carrying
    // it, so there is nothing to gain from throwing the fields away here.
    expect(token.refreshToken).toBe('refresh-token');
  });

  it('keeps a token that has not expired, without calling Entra', async () => {
    const token = await runJwt(expired({ accessTokenExpires: Date.now() + 600_000 }));

    expect(token.accessToken).toBe('old-access-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes against the user tenant, not the sign-in authority', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-access-token', expires_in: 3600 }),
    });

    await runJwt(expired());

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('11111111-2222-4333-8444-555555555555');
  });
});
