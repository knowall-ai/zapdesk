import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level coverage for PATCH /api/devops/tickets/[id]/state (#180). DevOps
// is mocked at the service boundary; the real DevOpsApiError and
// workItemToTicket are kept so error mapping and the response shape are real.

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: () => getServerSession() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const sendStatusChangeNotification = vi.fn();
vi.mock('@/lib/email', () => ({
  isEmailTicket: (tags: string) => tags.includes('email'),
  extractRequesterEmail: (tags: string) =>
    tags.includes('email') ? 'requester@example.test' : undefined,
  sendStatusChangeNotification: (...args: unknown[]) => sendStatusChangeNotification(...args),
}));

const getWorkItem = vi.fn();
const getProjects = vi.fn();
const updateTicketState = vi.fn();
vi.mock('@/lib/devops', async () => {
  const actual = await vi.importActual<typeof import('./devops')>('./devops');
  return {
    ...actual,
    AzureDevOpsService: class {
      getWorkItem = getWorkItem;
      getProjects = getProjects;
      updateTicketState = updateTicketState;
    },
  };
});

const { DevOpsApiError } = await import('./devops');

const workItem = (id: number, state: string, tags = '') => ({
  id,
  fields: {
    'System.Title': 'Printer offline',
    'System.State': state,
    'System.WorkItemType': 'Bug',
    'System.TeamProject': 'Internal',
    'System.Tags': tags,
    'System.CreatedBy': { id: 'u1', displayName: 'Dana Smith', uniqueName: 'dana@example.test' },
    'System.CreatedDate': '2026-10-01T00:00:00Z',
    'System.ChangedDate': '2026-10-02T00:00:00Z',
  },
});

const patch = async (id: string, body: unknown) => {
  const { PATCH } = await import('@/app/api/devops/tickets/[id]/state/route');
  const request = new NextRequest(`https://zapdesk.test/api/devops/tickets/${id}/state`, {
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-devops-org': 'KnowAll' },
  });
  const response = await PATCH(request, { params: Promise.resolve({ id }) });
  return { status: response.status, body: await response.json() };
};

describe('PATCH /api/devops/tickets/[id]/state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getServerSession.mockResolvedValue({ accessToken: 'token' });
    sendStatusChangeNotification.mockResolvedValue(undefined);
    getProjects.mockResolvedValue([{ id: 'p1', name: 'Internal' }]);
    getWorkItem.mockResolvedValue(workItem(42, 'Active'));
    updateTicketState.mockImplementation(async (_p: string, id: number, state: string) =>
      workItem(id, state)
    );
  });

  describe('authorization and validation', () => {
    it('returns 401 without a session token', async () => {
      getServerSession.mockResolvedValue(null);
      const { status } = await patch('42', { state: 'Resolved' });
      expect(status).toBe(401);
      expect(updateTicketState).not.toHaveBeenCalled();
    });

    it.each(['abc', '42abc', '0', '-1', '2147483648'])('rejects ticket id %j', async (id) => {
      const { status } = await patch(id, { state: 'Resolved' });
      expect(status).toBe(400);
      expect(updateTicketState).not.toHaveBeenCalled();
    });

    it.each([
      ['malformed JSON', '{not json'],
      ['a non-object body', ['Resolved']],
      ['a missing state', {}],
      ['a blank state', { state: '   ' }],
      ['a non-string state', { state: 3 }],
      ['an over-long state', { state: 'x'.repeat(129) }],
      ['a non-string project', { state: 'Resolved', project: 1 }],
      ['an unexpected field', { state: 'Resolved', priority: 1 }],
    ])('returns 400 for %s', async (_label, body) => {
      const { status } = await patch('42', body);
      expect(status).toBe(400);
      expect(updateTicketState).not.toHaveBeenCalled();
    });
  });

  describe('updating', () => {
    it('updates the state in the given project and returns the ticket', async () => {
      const { status, body } = await patch('42', { state: 'Resolved', project: ' Internal ' });

      expect(status).toBe(200);
      expect(updateTicketState).toHaveBeenCalledWith('Internal', 42, 'Resolved');
      expect(getProjects).not.toHaveBeenCalled();
      expect(body.ticket.id).toBe(42);
      expect(body.ticket.title).toBe('Printer offline');
    });

    it('finds the project by scanning when none is given', async () => {
      getProjects.mockResolvedValue([
        { id: 'p1', name: 'Other' },
        { id: 'p2', name: 'Internal' },
      ]);
      getWorkItem.mockImplementation(async (project: string, id: number) => {
        if (project === 'Other') throw new DevOpsApiError(404, 'Not found');
        return workItem(id, 'Active');
      });

      const { status } = await patch('42', { state: 'Resolved' });

      expect(status).toBe(200);
      expect(updateTicketState).toHaveBeenCalledWith('Internal', 42, 'Resolved');
    });

    it('returns 404 for a ticket that exists in no project', async () => {
      getWorkItem.mockRejectedValue(new DevOpsApiError(404, 'Not found'));
      const { status, body } = await patch('99999', { state: 'Resolved' });
      expect(status).toBe(404);
      expect(body.error).toBe('Ticket not found');
      expect(updateTicketState).not.toHaveBeenCalled();
    });

    // Only a 404 means "not in this project"; anything else is a real failure
    // that must not be reported as a missing ticket (#391).
    it('surfaces a lookup failure instead of reporting the ticket missing', async () => {
      getWorkItem.mockRejectedValue(new DevOpsApiError(401, 'Token expired'));
      const { status, body } = await patch('42', { state: 'Resolved' });
      expect(status).toBe(401);
      expect(body.error).toBe('Token expired');
    });

    it('emails the requester about a state change on an email ticket', async () => {
      getWorkItem.mockResolvedValue(workItem(42, 'Active', 'ticket; email'));
      updateTicketState.mockResolvedValue({
        ...workItem(42, 'Resolved', 'ticket; email'),
      });

      await patch('42', { state: 'Resolved', project: 'Internal' });

      expect(sendStatusChangeNotification).toHaveBeenCalledWith(
        42,
        'Printer offline',
        'requester@example.test',
        'Active',
        'Resolved'
      );
    });

    it('does not email for a ticket that did not come from email', async () => {
      await patch('42', { state: 'Resolved', project: 'Internal' });
      expect(sendStatusChangeNotification).not.toHaveBeenCalled();
    });
  });

  describe('invalid transitions and upstream errors', () => {
    // The upstream workflow message is what tells the user why a drag failed.
    it.each([400, 409])('passes a %i workflow rejection through with its message', async (code) => {
      updateTicketState.mockRejectedValue(
        new DevOpsApiError(code, "The field 'State' contains the value 'Done' that is not allowed")
      );
      const { status, body } = await patch('42', { state: 'Done', project: 'Internal' });
      expect(status).toBe(code);
      expect(body.error).toContain('not allowed');
    });

    it.each([401, 403, 404])('passes through a %i from DevOps', async (code) => {
      updateTicketState.mockRejectedValue(new DevOpsApiError(code, `Upstream ${code}`));
      const { status } = await patch('42', { state: 'Resolved', project: 'Internal' });
      expect(status).toBe(code);
    });

    it('turns other DevOps errors into a 500', async () => {
      updateTicketState.mockRejectedValue(new DevOpsApiError(503, 'Service unavailable'));
      const { status } = await patch('42', { state: 'Resolved', project: 'Internal' });
      expect(status).toBe(500);
    });

    it('turns unexpected errors into a generic 500', async () => {
      updateTicketState.mockRejectedValue(new Error('socket hang up'));
      const { status, body } = await patch('42', { state: 'Resolved', project: 'Internal' });
      expect(status).toBe(500);
      expect(body.error).toBe('Failed to update ticket state');
    });
  });
});
