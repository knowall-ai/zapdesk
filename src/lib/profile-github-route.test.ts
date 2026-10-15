import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level coverage for /api/profile/github (#455). Graph is mocked at
// fetch; validation, the claim check and the save are real.

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: () => getServerSession() }));
vi.mock('@/lib/auth', () => ({ authOptions: {}, getGraphToken: async () => 'graph-token' }));

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

/** Graph answering a user list in which `others` have saved these usernames. */
function graph(linked: Array<{ upn: string; login: string }>) {
  fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
    if (input.includes('/users?')) {
      return Response.json({
        value: linked.map((entry, i) => ({
          id: `u${i}`,
          displayName: entry.upn,
          userPrincipalName: entry.upn,
          extensions: [{ id: 'zapdesk.knowall.ai', githubUsername: entry.login }],
        })),
      });
    }
    if (init?.method === 'PATCH') return new Response(null, { status: 204 });
    return new Response('{}', { status: 404 });
  });
}

const post = async (githubUsername: unknown) => {
  const { POST } = await import('@/app/api/profile/github/route');
  const request = new NextRequest('https://zapdesk.test/api/profile/github', {
    method: 'POST',
    body: JSON.stringify({ githubUsername }),
  });
  const response = await POST(request);
  return { status: response.status, body: await response.json() };
};

const patches = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');

describe('POST /api/profile/github', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getServerSession.mockResolvedValue({ user: { email: 'Dana@example.test' } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('saves a username, tidied from a profile link', async () => {
    graph([]);
    const { status, body } = await post('https://github.com/dana-dev');
    expect(status).toBe(200);
    expect(body.githubUsername).toBe('dana-dev');
    expect(JSON.parse(String(patches()[0][1]?.body))).toEqual({ githubUsername: 'dana-dev' });
  });

  it('refuses something that is not a username', async () => {
    graph([]);
    const { status } = await post('dana dev');
    expect(status).toBe(400);
    expect(patches()).toHaveLength(0);
  });

  it('refuses a username another person has linked, whatever the case', async () => {
    graph([{ upn: 'sam@example.test', login: 'Dana-Dev' }]);
    const { status, body } = await post('dana-dev');
    expect(status).toBe(409);
    expect(body.error).toContain('already linked');
    expect(patches()).toHaveLength(0);
  });

  it('lets a person save their own username again', async () => {
    graph([{ upn: 'dana@example.test', login: 'dana-dev' }]);
    const { status } = await post('Dana-Dev');
    expect(status).toBe(200);
  });

  it('refuses to save when the check cannot read the users', async () => {
    fetchMock.mockImplementation(async (input: string) =>
      input.includes('/users?')
        ? new Response('{}', { status: 403 })
        : new Response(null, { status: 204 })
    );
    const { status } = await post('dana-dev');
    expect(status).toBe(503);
    expect(patches()).toHaveLength(0);
  });

  it('needs a signed-in user', async () => {
    getServerSession.mockResolvedValue(null);
    const { status } = await post('dana-dev');
    expect(status).toBe(401);
  });
});
