import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac, createVerify, generateKeyPairSync } from 'crypto';
import {
  appJwt,
  appProjectRepos,
  clearGitHubAppCaches,
  signConnectState,
  readProjectInstallation,
  userCanAccessInstallation,
  verifyConnectState,
  verifyWebhookSignature,
  writeProjectInstallation,
  type GitHubAppConfig,
} from './github-app';

// The ZapDesk GitHub App (#457). GitHub and Azure DevOps are mocked at fetch;
// signing, verification and the mapping are real.

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const config: GitHubAppConfig = {
  appId: '12345',
  privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
  slug: 'zapdesk',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  webhookSecret: 'hook-secret',
};

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

describe('app JWT', () => {
  it('is signed with the private key and names the App', () => {
    const now = Date.UTC(2026, 9, 15, 12, 0, 0);
    const [header, payload, signature] = appJwt(config, now).split('.');

    const valid = createVerify('RSA-SHA256')
      .update(`${header}.${payload}`)
      .verify(publicKey, signature, 'base64url');
    expect(valid).toBe(true);

    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    expect(claims.iss).toBe('12345');
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
  });
});

describe('connect state', () => {
  const now = 1_000_000;
  const state = { org: 'acme', projectId: 'p1', user: 'u1' };

  it('round-trips', () => {
    expect(verifyConnectState(signConnectState(state, now, 'secret'), now, 'secret')).toEqual({
      ...state,
      exp: now + 30 * 60 * 1000,
    });
  });

  it('rejects a changed, forged or expired state', () => {
    const signed = signConnectState(state, now, 'secret');
    const [, signature] = signed.split('.');
    const otherProject = Buffer.from(
      JSON.stringify({ ...state, projectId: 'p2', exp: now + 1000 })
    ).toString('base64url');

    expect(verifyConnectState(`${otherProject}.${signature}`, now, 'secret')).toBeNull();
    expect(verifyConnectState(signed, now, 'another-secret')).toBeNull();
    expect(verifyConnectState(signed, now + 31 * 60 * 1000, 'secret')).toBeNull();
    expect(verifyConnectState('rubbish', now, 'secret')).toBeNull();
    expect(verifyConnectState(null, now, 'secret')).toBeNull();
  });
});

describe('webhook signature', () => {
  it('accepts only GitHub-signed bodies', () => {
    const body = '{"action":"opened"}';
    const signature = `sha256=${createHmac('sha256', 'hook-secret').update(body).digest('hex')}`;
    expect(verifyWebhookSignature(body, signature, 'hook-secret')).toBe(true);
    expect(verifyWebhookSignature(`${body} `, signature, 'hook-secret')).toBe(false);
    expect(verifyWebhookSignature(body, signature, 'wrong')).toBe(false);
    expect(verifyWebhookSignature(body, null, 'hook-secret')).toBe(false);
  });
});

describe('with GitHub and Azure DevOps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGitHubAppCaches();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('trusts an installation id only when the authorising user can reach it', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('/login/oauth/access_token')) return Response.json({ access_token: 'user' });
      if (url.includes('/user/installations')) {
        return Response.json({ installations: [{ id: 11 }, { id: 12 }] });
      }
      return new Response('{}', { status: 404 });
    });

    expect(await userCanAccessInstallation(config, 'code', 12)).toBe(true);
    expect(await userCanAccessInstallation(config, 'code', 99)).toBe(false);
  });

  it('refuses when the code cannot be exchanged', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'bad_verification_code' }));
    expect(await userCanAccessInstallation(config, 'stale', 12)).toBe(false);
  });

  it('keeps the link on the DevOps project, written with the user token', async () => {
    fetchMock.mockResolvedValue(Response.json({}));

    await writeProjectInstallation('acme', 'p1', 'user-token', {
      installationId: 12,
      account: 'acme-gh',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('https://dev.azure.com/acme/_apis/projects/p1/properties');
    expect(init?.method).toBe('PATCH');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer user-token');
    expect(JSON.parse(String(init?.body))).toEqual([
      {
        op: 'add',
        path: '/ZapDesk.GitHubInstallation',
        value: JSON.stringify({ installationId: 12, account: 'acme-gh' }),
      },
    ]);
  });

  // A project's link is read with the user's token, so Azure DevOps checks they
  // may see the project; a cached copy must not reach anyone else (#457 review).
  it('caches a project link per user, and forgets every copy when it changes', async () => {
    fetchMock.mockImplementation(async (_url, init) =>
      init?.method === 'PATCH'
        ? Response.json({})
        : Response.json({
            value: [
              {
                name: 'ZapDesk.GitHubInstallation',
                value: JSON.stringify({ installationId: 12, account: 'acme-gh' }),
              },
            ],
          })
    );
    const reads = () => fetchMock.mock.calls.filter(([, init]) => init?.method !== 'PATCH');

    await readProjectInstallation('acme', 'p1', 'alice-token');
    await readProjectInstallation('acme', 'p1', 'alice-token');
    expect(reads()).toHaveLength(1);

    await readProjectInstallation('acme', 'p1', 'bob-token');
    expect(reads()).toHaveLength(2);
    expect((reads()[1][1]?.headers as Record<string, string>).Authorization).toBe(
      'Bearer bob-token'
    );

    await writeProjectInstallation('acme', 'p1', 'alice-token', null);
    await readProjectInstallation('acme', 'p1', 'bob-token');
    expect(reads()).toHaveLength(3);
  });

  it('passes on a refusal from Azure DevOps', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 403 }));
    await expect(
      writeProjectInstallation('acme', 'p1', 'user-token', { installationId: 12, account: '' })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('maps each connected project to its installation repositories and token', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (url.includes('/projects/p1/properties')) {
        return Response.json({
          value: [
            {
              name: 'ZapDesk.GitHubInstallation',
              value: JSON.stringify({ installationId: 12, account: 'acme-gh' }),
            },
          ],
        });
      }
      if (url.includes('/projects/p2/properties')) return Response.json({ value: [] });
      if (url.includes('/app/installations/12/access_tokens') && init?.method === 'POST') {
        return Response.json({ token: 'inst-12', expires_at: '2099-01-01T00:00:00Z' });
      }
      if (url.includes('/installation/repositories')) {
        return Response.json({
          repositories: [{ full_name: 'acme-gh/portal' }, { full_name: 'acme-gh/API' }],
        });
      }
      return new Response('{}', { status: 404 });
    });

    const projects = [
      { id: 'p1', name: 'Help Desk', url: '', state: 'wellFormed' },
      { id: 'p2', name: 'Internal', url: '', state: 'wellFormed' },
    ];
    const mapping = await appProjectRepos(config, 'acme', projects, 'user-token');

    expect(mapping.projectRepos).toEqual({ 'Help Desk': ['acme-gh/portal', 'acme-gh/API'] });
    expect(mapping.tokens).toEqual({ 'acme-gh/portal': 'inst-12', 'acme-gh/api': 'inst-12' });
    expect(mapping.failed).toEqual([]);
  });
});
