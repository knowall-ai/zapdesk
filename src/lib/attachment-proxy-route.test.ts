import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level coverage for GET /api/devops/attachments/[id] (#7719): query
// validation and the download disposition. DevOps is the global fetch, mocked.

const getServerSession = vi.fn();
vi.mock('@/lib/server-session', () => ({
  getServerSessionWithToken: () => getServerSession(),
}));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const ID = '11111111-2222-3333-4444-555555555555';

const get = async (query: string) => {
  const { GET } = await import('@/app/api/devops/attachments/[id]/route');
  const request = new NextRequest(`https://zapdesk.test/api/devops/attachments/${ID}?${query}`);
  return GET(request, { params: Promise.resolve({ id: ID }) });
};

describe('GET /api/devops/attachments/[id]', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    getServerSession.mockResolvedValue({ accessToken: 'token' });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response('file-bytes', { headers: { 'content-type': 'text/plain' } })
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens inline by default, as pasted images need', async () => {
    const response = await get('fileName=log.txt&org=KnowAll');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('inline; filename="log.txt"');
  });

  it('downloads with download=1', async () => {
    const response = await get('fileName=log.txt&org=KnowAll&download=1');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="log.txt"');
  });

  it.each(['download=true', 'download=01', 'download='])('rejects %s', async (query) => {
    const response = await get(`fileName=log.txt&${query}`);
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a parameter it does not read, before fetching anything', async () => {
    const response = await get('fileName=log.txt&dowload=1');
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('dowload');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
