import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// PATCH /api/devops/tickets/[id] with a pasted screenshot in the description.
// Only the network is mocked, so the upload and the JSON Patch are checked.

const getServerSession = vi.fn();
vi.mock('@/lib/server-session', () => ({
  getServerSessionWithToken: () => getServerSession(),
}));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const ATTACHMENT = 'https://dev.azure.com/KnowAllTest/_apis/wit/attachments/abc-123';
const workItem = {
  id: 7,
  fields: {
    'System.Title': 'Printer offline',
    'System.State': 'Active',
    'System.WorkItemType': 'Bug',
    'System.TeamProject': 'Contoso',
    'System.Tags': 'ticket',
    'System.CreatedBy': { id: 'u1', displayName: 'Sam Taylor', uniqueName: 'sam@example.test' },
    'System.CreatedDate': '2026-10-01T00:00:00Z',
    'System.ChangedDate': '2026-10-02T00:00:00Z',
  },
};

const fetchMock = vi.fn();
const uploads = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes('/_apis/wit/attachments'));
const patchesSent = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as unknown[]);

const IMAGE = `<img alt="before > after" src="data:image/png;base64,${Buffer.from('png').toString('base64')}">`;

const patch = async (body: unknown) => {
  const { PATCH } = await import('@/app/api/devops/tickets/[id]/route');
  const request = new NextRequest('https://zapdesk.test/api/devops/tickets/7', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-devops-org': 'KnowAllTest' },
  });
  const response = await PATCH(request, { params: Promise.resolve({ id: '7' }) });
  return { status: response.status, body: await response.json() };
};

// The first test pays for importing the route.
describe('PATCH /api/devops/tickets/[id] -- pasted images', { timeout: 20_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSession.mockResolvedValue({ accessToken: 'token', user: { name: 'Sam Taylor' } });
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/_apis/wit/attachments')
        ? new Response(JSON.stringify({ id: 'abc-123', url: ATTACHMENT }))
        : new Response(JSON.stringify(workItem))
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('stores the image as an attachment and the description points at it', async () => {
    const { status } = await patch({ project: 'Contoso', description: `<p>See</p>${IMAGE}` });

    expect(status).toBe(200);
    expect(uploads()).toHaveLength(1);
    expect(patchesSent()).toEqual([
      [
        {
          op: 'add',
          path: '/fields/System.Description',
          value: `<p>See</p><img alt="before > after" src="${ATTACHMENT}">`,
        },
      ],
    ]);
  });

  // #697 review: a request refused for its tags must not have uploaded anything.
  it('uploads nothing when the request is refused', async () => {
    const { status } = await patch({ project: 'Contoso', description: IMAGE, tags: ['bad;tag'] });

    expect(status).toBe(400);
    expect(uploads()).toHaveLength(0);
    expect(patchesSent()).toEqual([]);
  });
});
