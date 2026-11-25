import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// GET /api/devops/workitem-states?types=... refuses a list over its cap rather
// than answering for part of it (#687 review).

vi.mock('@/lib/server-session', () => ({
  getServerSessionWithToken: async () => ({ accessToken: 'token' }),
}));

const fetchMock = vi.fn(
  async () => new Response(JSON.stringify({ value: [{ name: 'New', category: 'Proposed' }] }))
);

const call = async (types: string[]) => {
  const { GET } = await import('@/app/api/devops/workitem-states/route');
  const url = `https://zapdesk.test/api/devops/workitem-states?project=Contoso&types=${encodeURIComponent(types.join(','))}`;
  return GET(new NextRequest(url, { headers: { 'x-devops-org': 'KnowAllTest' } }));
};

describe('workitem-states types list', () => {
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('answers for every type in a list of 20', async () => {
    const response = await call(Array.from({ length: 20 }, (_, i) => `Type${i}`));
    expect(response.status).toBe(200);
    expect((await response.json()).statesByType).toHaveLength(20);
  });

  it('refuses 21, without asking DevOps', async () => {
    const response = await call(Array.from({ length: 21 }, (_, i) => `Type${i}`));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
