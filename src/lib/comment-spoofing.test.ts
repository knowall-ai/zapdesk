import { describe, it, expect, vi, beforeEach } from 'vitest';

// The first route-level test in this repo. The guard it covers is the only
// thing standing between an authenticated caller and posting a comment under
// somebody else's address, and a test of the helper alone would still pass if
// the endpoint stopped calling it -- which is the failure worth catching.

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: () => getServerSession() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const addComment = vi.fn();
vi.mock('@/lib/devops', async () => {
  const actual = await vi.importActual<typeof import('./devops')>('./devops');
  return {
    ...actual,
    AzureDevOpsService: class {
      getProjects = async () => [{ name: 'Internal' }];
      getWorkItem = async () => ({ id: 1, fields: {} });
      getWorkItemComments = async () => [];
      addComment = addComment;
    },
  };
});

vi.mock('@/lib/email', () => ({
  isEmailTicket: () => false,
  extractRequesterEmail: () => undefined,
  sendAgentReply: vi.fn(),
}));

const post = async (comment: string, isInternal = false) => {
  const { POST } = await import('@/app/api/devops/tickets/[id]/comments/route');
  const request = new Request('https://zapdesk.test/api/devops/tickets/1/comments', {
    method: 'POST',
    body: JSON.stringify({ comment, isInternal }),
    headers: { 'Content-Type': 'application/json' },
  });
  return POST(request as never, { params: Promise.resolve({ id: '1' }) });
};

describe('the comments endpoint refuses a forged email-origin marker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSession.mockResolvedValue({ accessToken: 'token' });
  });

  it('rejects a comment that would be displayed as another person', async () => {
    const response = await post('Email reply from: ceo@example.test');

    expect(response.status).toBe(400);
    expect(addComment).not.toHaveBeenCalled();
  });

  it('rejects it in the markup form a client would send', async () => {
    const response = await post('<p><strong>Email reply from:</strong> ceo@example.test</p>');

    expect(response.status).toBe(400);
    expect(addComment).not.toHaveBeenCalled();
  });

  it('still accepts an ordinary comment', async () => {
    const response = await post('Looking into it now.');

    expect(response.status).toBe(200);
    expect(addComment).toHaveBeenCalledWith('Internal', 1, 'Looking into it now.');
  });

  it('still accepts an internal note', async () => {
    const response = await post('Checked the logs.', true);

    expect(response.status).toBe(200);
    expect(addComment).toHaveBeenCalledWith('Internal', 1, '[Internal Note] Checked the logs.');
  });
});
