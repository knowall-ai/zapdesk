import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// GET /api/devops/projects/[project]/workitemtypes/[type]/fields/[fieldRef]:
// a type without the field is a 404, told apart by status rather than by the
// status text, which can be empty (#681 review).

const getServerSession = vi.fn();
vi.mock('@/lib/server-session', () => ({
  getServerSessionWithToken: () => getServerSession(),
}));

const fetchMock = vi.fn();

const lookup = async () => {
  const { GET } =
    await import('@/app/api/devops/projects/[project]/workitemtypes/[type]/fields/[fieldRef]/route');
  const request = new NextRequest(
    'https://zapdesk.test/api/devops/projects/Contoso/workitemtypes/Task/fields/Custom.ApprovedBy',
    { headers: { 'x-devops-org': 'KnowAllTest' } }
  );
  const response = await GET(request, {
    params: Promise.resolve({ project: 'Contoso', type: 'Task', fieldRef: 'Custom.ApprovedBy' }),
  });
  return response.status;
};

describe('work item type field lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSession.mockResolvedValue({ accessToken: 'token' });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers 404 for a field the type lacks, even with no status text', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404, statusText: '' }));
    expect(await lookup()).toBe(404);
  });

  it('still answers 500 for anything else', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 503, statusText: 'Not Found' }));
    expect(await lookup()).toBe(500);
  });

  it('answers 200 when the type has it', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ name: 'Approved By' })));
    expect(await lookup()).toBe(200);
  });
});
