import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { MAX_TITLE_LENGTH } from './ticket-title';

// Route-level coverage for PATCH /api/devops/tickets/[id]: input validation
// and the customer's title/priority email (#7724). DevOps is mocked at the
// service boundary; the real workItemToTicket and email tag helpers are kept.

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: () => getServerSession() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const sendTicketUpdateNotification = vi.fn(async (..._args: unknown[]) => {});
vi.mock('@/lib/email', async () => {
  const actual = await vi.importActual<typeof import('./email')>('./email');
  return {
    ...actual,
    sendAssignmentNotification: async () => {},
    sendTicketUpdateNotification: (...args: unknown[]) => sendTicketUpdateNotification(...args),
  };
});

const getWorkItem = vi.fn();
const updateTicketFields = vi.fn();
const getOriginalTitle = vi.fn(async (..._args: unknown[]): Promise<string | null> => null);
vi.mock('@/lib/devops', async () => {
  const actual = await vi.importActual<typeof import('./devops')>('./devops');
  return {
    ...actual,
    AzureDevOpsService: class {
      organizationName = 'KnowAll';
      getWorkItem = getWorkItem;
      updateTicketFields = updateTicketFields;
      getOriginalTitle = getOriginalTitle;
    },
  };
});

const workItem = (fields: Record<string, unknown>) => ({
  id: 7,
  fields: {
    'System.Title': 'Printer offline',
    'System.State': 'Active',
    'System.WorkItemType': 'Task',
    'System.TeamProject': 'Internal',
    'System.Tags': 'ticket; email; email-from:customer@example.test',
    'Microsoft.VSTS.Common.Priority': 3,
    'System.CreatedBy': { id: 'u1', displayName: 'Dana', uniqueName: 'dana@example.test' },
    'System.CreatedDate': '2026-10-01T00:00:00Z',
    'System.ChangedDate': '2026-10-02T00:00:00Z',
    ...fields,
  },
});

const patch = async (body: unknown) => {
  const { PATCH } = await import('@/app/api/devops/tickets/[id]/route');
  const request = new NextRequest('https://zapdesk.test/api/devops/tickets/7', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-devops-org': 'KnowAll' },
  });
  const response = await PATCH(request, { params: Promise.resolve({ id: '7' }) });
  return { status: response.status, body: await response.json() };
};

describe('PATCH /api/devops/tickets/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSession.mockResolvedValue({ accessToken: 'token', user: { name: 'Dana' } });
    getWorkItem.mockResolvedValue(workItem({}));
  });

  it('rejects a field it does not handle, before touching DevOps', async () => {
    const { status, body } = await patch({ project: 'Internal', priorty: 2 });
    expect(status).toBe(400);
    expect(body.error).toContain('priorty');
    expect(updateTicketFields).not.toHaveBeenCalled();
  });

  it.each([0, 5, 2.5, -1, '2', null])('rejects priority %j', async (priority) => {
    const { status } = await patch({ project: 'Internal', priority });
    expect(status).toBe(400);
    expect(updateTicketFields).not.toHaveBeenCalled();
  });

  it('emails the customer when the priority changes', async () => {
    updateTicketFields.mockResolvedValue(workItem({ 'Microsoft.VSTS.Common.Priority': 2 }));
    const { status } = await patch({ project: 'Internal', priority: 2 });
    expect(status).toBe(200);
    expect(sendTicketUpdateNotification).toHaveBeenCalledWith(
      7,
      { thread: 'Printer offline', current: 'Printer offline' },
      'customer@example.test',
      [{ label: 'Priority', from: 'Normal', to: 'High' }]
    );
  });

  it('keeps the old title for the thread and shows the new one in the body', async () => {
    updateTicketFields.mockResolvedValue(workItem({ 'System.Title': 'Printer still offline' }));
    await patch({ project: 'Internal', title: 'Printer still offline' });
    expect(sendTicketUpdateNotification).toHaveBeenCalledWith(
      7,
      { thread: 'Printer offline', current: 'Printer still offline' },
      'customer@example.test',
      [{ label: 'Title', from: 'Printer offline', to: 'Printer still offline' }]
    );
  });

  it('threads every update under the title the ticket was created with', async () => {
    // The title already changed once (to Printer offline); a later change must
    // still use the original subject, or the customer's thread splits.
    getOriginalTitle.mockResolvedValueOnce('Cannot print');
    updateTicketFields.mockResolvedValue(workItem({ 'System.Title': 'Printer still offline' }));
    await patch({ project: 'Internal', title: 'Printer still offline' });
    expect(getOriginalTitle).toHaveBeenCalledWith('Internal', 7);
    expect(sendTicketUpdateNotification).toHaveBeenCalledWith(
      7,
      { thread: 'Cannot print', current: 'Printer still offline' },
      'customer@example.test',
      expect.any(Array)
    );
  });

  it.each(['', '   ', null, 42])('rejects title %j before touching DevOps', async (title) => {
    const { status } = await patch({ project: 'Internal', title });
    expect(status).toBe(400);
    expect(updateTicketFields).not.toHaveBeenCalled();
  });

  it('rejects a title longer than DevOps accepts, saying what the limit is', async () => {
    const { status, body } = await patch({
      project: 'Internal',
      title: 'x'.repeat(MAX_TITLE_LENGTH + 1),
    });
    expect(status).toBe(400);
    expect(body.error).toContain(String(MAX_TITLE_LENGTH));
    expect(updateTicketFields).not.toHaveBeenCalled();
  });

  it('saves a title trimmed, so padding cannot reach DevOps', async () => {
    updateTicketFields.mockResolvedValue(workItem({ 'System.Title': 'Printer offline' }));
    const { status } = await patch({ project: 'Internal', title: '  Printer still offline  ' });
    expect(status).toBe(200);
    expect(updateTicketFields).toHaveBeenCalledWith(
      'Internal',
      7,
      expect.objectContaining({ title: 'Printer still offline' })
    );
  });

  it('rejects tags that are not a list instead of skipping them', async () => {
    const { status } = await patch({ project: 'Internal', title: 'New', tags: 'ticket' });
    expect(status).toBe(400);
    expect(updateTicketFields).not.toHaveBeenCalled();
  });

  it('sends to the original requester even when the same request rewrites the tags', async () => {
    updateTicketFields.mockResolvedValue(
      workItem({
        'System.Title': 'New title',
        'System.Tags': 'ticket; email; email-from:attacker@example.test',
      })
    );
    await patch({
      project: 'Internal',
      title: 'New title',
      tags: ['ticket', 'email', 'email-from:attacker@example.test'],
    });
    expect(sendTicketUpdateNotification).toHaveBeenCalledWith(
      7,
      { thread: 'Printer offline', current: 'New title' },
      'customer@example.test',
      expect.any(Array)
    );
  });

  it('does not email when nothing the customer sees changed', async () => {
    updateTicketFields.mockResolvedValue(workItem({}));
    await patch({ project: 'Internal', priority: 3 });
    expect(sendTicketUpdateNotification).not.toHaveBeenCalled();
  });
});
