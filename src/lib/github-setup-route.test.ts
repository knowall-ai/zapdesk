import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { generateKeyPairSync } from 'crypto';
import { clearGitHubAppCaches, signConnectState } from './github-app';

// Route-level coverage for /api/github/setup (#457): an installation is only
// linked to a project when the state, the GitHub user and Azure DevOps all
// agree. GitHub and DevOps are mocked at fetch.

const getServerSession = vi.fn();
vi.mock('@/lib/server-session', () => ({
  getServerSessionWithToken: () => getServerSession(),
}));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

/** GitHub says the user can reach these installations; DevOps answers `devOpsStatus`. */
function world(reachable: number[], devOpsStatus = 200) {
  fetchMock.mockImplementation(async (url) => {
    if (url.includes('/login/oauth/access_token')) return Response.json({ access_token: 'user' });
    if (url.includes('/user/installations')) {
      return Response.json({ installations: reachable.map((id) => ({ id })) });
    }
    if (url.includes('/app/installations/')) {
      return Response.json({ id: 12, account: { login: 'acme-gh' }, repository_selection: 'all' });
    }
    if (url.includes('/properties')) return new Response('{}', { status: devOpsStatus });
    return new Response('{}', { status: 404 });
  });
}

const setup = async (params: Record<string, string>) => {
  const { GET } = await import('@/app/api/github/setup/route');
  const url = new URL('https://zapdesk.test/api/github/setup');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await GET(new NextRequest(url));
  return new URL(response.headers.get('location') || '').searchParams.get('github');
};

const devOpsWrites = () => fetchMock.mock.calls.filter(([url]) => url.includes('/properties'));

describe('GET /api/github/setup', () => {
  let state: string;

  beforeEach(() => {
    vi.clearAllMocks();
    clearGitHubAppCaches();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret');
    vi.stubEnv('NEXTAUTH_URL', 'https://zapdesk.test');
    vi.stubEnv('GITHUB_APP_ID', '1');
    vi.stubEnv(
      'GITHUB_APP_PRIVATE_KEY',
      privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
    );
    vi.stubEnv('GITHUB_APP_SLUG', 'zapdesk');
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'cid');
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'csecret');
    getServerSession.mockResolvedValue({ accessToken: 'devops-token', user: { id: 'u1' } });
    state = signConnectState({ org: 'acme', projectId: 'p1', user: 'u1' });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('links an installation the user can reach', async () => {
    world([12]);
    expect(await setup({ state, installation_id: '12', code: 'c', setup_action: 'install' })).toBe(
      'connected'
    );
    expect(devOpsWrites()).toHaveLength(1);
  });

  it('refuses an installation id the user cannot reach', async () => {
    world([7]);
    expect(await setup({ state, installation_id: '12', code: 'c' })).toBe('forbidden');
    expect(devOpsWrites()).toHaveLength(0);
  });

  it('refuses a state started by someone else', async () => {
    world([12]);
    const theirs = signConnectState({ org: 'acme', projectId: 'p1', user: 'someone-else' });
    const response = await setup({ state: theirs, installation_id: '12', code: 'c' });
    expect(response).toBe('expired');
    expect(devOpsWrites()).toHaveLength(0);
  });

  it('reports when Azure DevOps will not let the user edit the project', async () => {
    world([12], 403);
    expect(await setup({ state, installation_id: '12', code: 'c' })).toBe('forbidden');
  });

  it('needs the GitHub code', async () => {
    world([12]);
    expect(await setup({ state, installation_id: '12' })).toBe('failed');
    expect(devOpsWrites()).toHaveLength(0);
  });
});
