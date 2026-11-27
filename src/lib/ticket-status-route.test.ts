import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// PATCH /api/devops/tickets/[id]/status is what the bulk actions on the
// tickets list call, one request per selected ticket. It used to change the
// state and return without telling the customer, while the same change from
// the ticket page (/state) did
// (https://github.com/knowall-ai/zapdesk/issues/728). DevOps is mocked at the service
// boundary; only the outbound send is mocked in the email module, so the
// email tags are read by the real helpers.

const getServerSession = vi.fn();
vi.mock('@/lib/server-session', () => ({
  getServerSessionWithToken: () => getServerSession(),
}));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const sendStatusChangeNotification = vi.fn();
vi.mock('@/lib/email', async () => {
  const actual = await vi.importActual<typeof import('./email')>('./email');
  return {
    ...actual,
    sendStatusChangeNotification: (...args: unknown[]) => sendStatusChangeNotification(...args),
  };
});

const getWorkItem = vi.fn();
const getProjects = vi.fn();
const findProjectForWorkItem = vi.fn();
const getWorkItemTypeStates = vi.fn();
const updateTicketState = vi.fn();
vi.mock('@/lib/devops', async () => {
  const actual = await vi.importActual<typeof import('./devops')>('./devops');
  return {
    ...actual,
    AzureDevOpsService: class {
      getWorkItem = getWorkItem;
      getProjects = getProjects;
      findProjectForWorkItem = findProjectForWorkItem;
      getWorkItemTypeStates = getWorkItemTypeStates;
      updateTicketState = updateTicketState;
    },
  };
});

const { DevOpsApiError } = await import('./devops');

const STATES = [
  { name: 'New', category: 'Proposed' },
  { name: 'Active', category: 'InProgress' },
  { name: 'Resolved', category: 'Resolved' },
  { name: 'Closed', category: 'Completed' },
];

const emailTags = (address: string) => `ticket; email; email-from:${address}`;

const workItem = (id: number, state: string | undefined, tags = '') => ({
  id,
  fields: {
    'System.Title': `Printer offline ${id}`,
    ...(state === undefined ? {} : { 'System.State': state }),
    'System.WorkItemType': 'Bug',
    'System.TeamProject': 'Internal',
    'System.Tags': tags,
    'System.CreatedBy': { id: 'u1', displayName: 'Dana Smith', uniqueName: 'dana@example.test' },
    'System.CreatedDate': '2026-10-01T00:00:00Z',
    'System.ChangedDate': '2026-10-02T00:00:00Z',
  },
});

/** The tickets DevOps holds, by id; reads and updates go through this. */
let store: Map<number, ReturnType<typeof workItem>>;

const request = (id: number, route: 'status' | 'state', body: unknown) =>
  new NextRequest(`https://zapdesk.test/api/devops/tickets/${id}/${route}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-devops-org': 'KnowAll' },
  });

/** One bulk action: one /status request per ticket, as WorkItemBoard sends them. */
const bulk = async (ids: number[], status: string) => {
  const { PATCH } = await import('@/app/api/devops/tickets/[id]/status/route');
  return Promise.all(
    ids.map(async (id) => {
      const response = await PATCH(request(id, 'status', { status, project: 'Internal' }), {
        params: Promise.resolve({ id: String(id) }),
      });
      return response.status;
    })
  );
};

/** The same change from the ticket page. */
const single = async (id: number, state: string) => {
  const { PATCH } = await import('@/app/api/devops/tickets/[id]/state/route');
  const response = await PATCH(request(id, 'state', { state, project: 'Internal' }), {
    params: Promise.resolve({ id: String(id) }),
  });
  return response.status;
};

describe('PATCH /api/devops/tickets/[id]/status: the requester is told', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('CUSTOMER_NOTIFY_STATES', '');
    getServerSession.mockResolvedValue({ accessToken: 'token' });
    sendStatusChangeNotification.mockResolvedValue(undefined);
    getProjects.mockResolvedValue([{ id: 'p1', name: 'Internal' }]);
    getWorkItemTypeStates.mockResolvedValue(STATES);
    store = new Map();
    getWorkItem.mockImplementation(async (_project: string, id: number) => store.get(id) ?? null);
    updateTicketState.mockImplementation(async (_project: string, id: number, state: string) => {
      const saved = workItem(id, state, String(store.get(id)?.fields['System.Tags'] ?? ''));
      store.set(id, saved);
      return saved;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('sends one status email per emailed ticket, to its own requester', async () => {
    store.set(101, workItem(101, 'Active', emailTags('alex.morgan@example.test')));
    store.set(102, workItem(102, 'Resolved', emailTags('sam.taylor@example.test')));
    store.set(103, workItem(103, 'Active')); // raised in the portal, not by email

    const statuses = await bulk([101, 102, 103], 'Closed');

    expect(statuses).toEqual([200, 200, 200]);
    expect(sendStatusChangeNotification).toHaveBeenCalledTimes(2);
    expect(sendStatusChangeNotification).toHaveBeenCalledWith(
      101,
      'Printer offline 101',
      'alex.morgan@example.test',
      'Active',
      'Closed',
      undefined,
      undefined,
      'Internal'
    );
    expect(sendStatusChangeNotification).toHaveBeenCalledWith(
      102,
      'Printer offline 102',
      'sam.taylor@example.test',
      'Resolved',
      'Closed',
      undefined,
      undefined,
      'Internal'
    );
  });

  it.each([
    ['Re-open', 'Open', 'Closed', 'Active'],
    ['Set to In Progress', 'In Progress', 'New', 'Active'],
  ])('%s tells the requester too', async (_label, status, before, after) => {
    store.set(201, workItem(201, before, emailTags('alex.morgan@example.test')));

    await bulk([201], status);

    expect(sendStatusChangeNotification).toHaveBeenCalledTimes(1);
    expect(sendStatusChangeNotification.mock.calls[0].slice(2, 5)).toEqual([
      'alex.morgan@example.test',
      before,
      after,
    ]);
  });

  // Each case is one the ticket page stays quiet on; the bulk path must too.
  describe('sends nothing where a change from the ticket page sends nothing', () => {
    it('the ticket is already in that state', async () => {
      store.set(301, workItem(301, 'Closed', emailTags('alex.morgan@example.test')));
      await bulk([301], 'Closed');
      expect(updateTicketState).toHaveBeenCalledWith('Internal', 301, 'Closed');
      expect(sendStatusChangeNotification).not.toHaveBeenCalled();
    });

    it('the ticket did not arrive by email', async () => {
      store.set(302, workItem(302, 'Active', 'ticket'));
      await bulk([302], 'Closed');
      expect(sendStatusChangeNotification).not.toHaveBeenCalled();
    });

    it('the requester is ZapDesk itself', async () => {
      vi.stubEnv('MAIL_FROM', 'support@example.test');
      store.set(303, workItem(303, 'Active', emailTags('support@example.test')));
      await bulk([303], 'Closed');
      expect(sendStatusChangeNotification).not.toHaveBeenCalled();
    });

    it('customers are not told about the new state', async () => {
      vi.stubEnv('CUSTOMER_NOTIFY_STATES', 'closed');
      store.set(304, workItem(304, 'New', emailTags('alex.morgan@example.test')));
      await bulk([304], 'In Progress');
      expect(updateTicketState).toHaveBeenCalledWith('Internal', 304, 'Active');
      expect(sendStatusChangeNotification).not.toHaveBeenCalled();
    });

    it('the earlier state could not be read', async () => {
      store.set(305, workItem(305, undefined, emailTags('alex.morgan@example.test')));
      await bulk([305], 'Closed');
      expect(updateTicketState).toHaveBeenCalled();
      expect(sendStatusChangeNotification).not.toHaveBeenCalled();
    });

    it('the update was refused', async () => {
      store.set(306, workItem(306, 'Active', emailTags('alex.morgan@example.test')));
      updateTicketState.mockRejectedValueOnce(new DevOpsApiError(400, 'Rule refused'));
      const statuses = await bulk([306], 'Closed');
      expect(statuses).toEqual([400]);
      expect(sendStatusChangeNotification).not.toHaveBeenCalled();
    });
  });

  it('sends exactly what the ticket page sends for the same change', async () => {
    const seed = () => {
      store.set(401, workItem(401, 'Active', emailTags('alex.morgan@example.test')));
      store.set(402, workItem(402, 'Closed', emailTags('sam.taylor@example.test')));
      store.set(403, workItem(403, 'Active'));
    };

    seed();
    for (const id of [401, 402, 403]) await single(id, 'Closed');
    const fromTicketPage = sendStatusChangeNotification.mock.calls.map((call) => [...call]);

    sendStatusChangeNotification.mockClear();
    seed();
    await bulk([401, 402, 403], 'Closed');
    const fromBulk = sendStatusChangeNotification.mock.calls.map((call) => [...call]);

    expect(fromTicketPage).toHaveLength(1);
    expect(fromBulk).toEqual(fromTicketPage);
  });
});
