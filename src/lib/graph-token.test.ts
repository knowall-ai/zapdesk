import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearGraphTokenCache, getGraphToken, signInAuthority } from './auth';
import { clearLinkedAccountsCache, linkedGitHubAccounts } from './github-issues';

// Multi-tenant sign-in (#457): the Graph app token comes from the signed-in
// user's tenant, and one tenant's saved GitHub usernames never reach another.

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

describe('Graph token per tenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGraphTokenCache();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('AZURE_AD_TENANT_ID', 'home-tenant');
    vi.stubEnv('AZURE_AD_CLIENT_ID', 'client');
    vi.stubEnv('AZURE_AD_CLIENT_SECRET', 'secret');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockImplementation(async (url) =>
      Response.json({ access_token: `token-for:${url}`, expires_in: 3600 })
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("asks the user's own tenant, and reuses the token", async () => {
    const token = await getGraphToken('customer-tenant');
    expect(token).toContain('/customer-tenant/oauth2/v2.0/token');
    await getGraphToken('customer-tenant');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await getGraphToken('another-tenant');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the home tenant, but never to common', async () => {
    expect(await getGraphToken()).toContain('/home-tenant/');

    vi.stubEnv('AZURE_AD_TENANT_ID', 'common');
    clearGraphTokenCache();
    expect(await getGraphToken()).toBeNull();
  });

  it('signs in through organizations only when multi-tenant is on', () => {
    expect(signInAuthority()).toBe('home-tenant');
    vi.stubEnv('AZURE_AD_MULTI_TENANT', 'true');
    expect(signInAuthority()).toBe('organizations');
  });
});

describe('saved GitHub usernames per tenant', () => {
  beforeEach(() => clearLinkedAccountsCache());

  it('keeps each tenant apart', async () => {
    const dana = { login: 'dana-dev', displayName: 'Dana Scully', email: 'dana@a.example.test' };
    await linkedGitHubAccounts(async () => [dana], 'tenant-a');

    const loadB = vi.fn().mockResolvedValue([]);
    expect(await linkedGitHubAccounts(loadB, 'tenant-b')).toEqual({});
    expect(loadB).toHaveBeenCalledTimes(1);

    clearLinkedAccountsCache('tenant-b');
    expect(await linkedGitHubAccounts(async () => [], 'tenant-a')).toEqual({ 'dana-dev': dana });
  });
});
