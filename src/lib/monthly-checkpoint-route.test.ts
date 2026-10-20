import { describe, it, expect, vi, beforeEach } from 'vitest';

// Route-level coverage for the customer filter on
// GET /api/devops/monthly-checkpoint (#7385). DevOps is mocked at the service
// boundary; the real workItemToTicket is kept, so requesters are read the way
// the route reads them.

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: () => getServerSession() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const getTickets = vi.fn();
vi.mock('@/lib/devops', async () => {
  const actual = await vi.importActual<typeof import('./devops')>('./devops');
  return {
    ...actual,
    AzureDevOpsService: class {
      organizationName = 'KnowAll';
      getTickets = getTickets;
    },
  };
});

/** A ticket raised by email, so the requester comes from its email-from tag. */
const ticketFrom = (id: number, requester: string) => ({
  id,
  fields: {
    'System.Title': `Ticket ${id}`,
    'System.State': 'New',
    'System.WorkItemType': 'Task',
    'System.TeamProject': 'Internal',
    'System.Tags': `ticket; email; email-from:${requester}`,
    'System.CreatedBy': { id: 'pat', displayName: 'Service', uniqueName: 'svc@example.test' },
    'System.CreatedDate': '2026-10-10T10:00:00Z',
    'System.ChangedDate': '2026-10-10T10:00:00Z',
  },
});

const get = async (query: string) => {
  const { GET } = await import('@/app/api/devops/monthly-checkpoint/route');
  const response = await GET(
    new Request(`https://zapdesk.test/api/devops/monthly-checkpoint?${query}`, {
      headers: { 'x-devops-org': 'KnowAll' },
    })
  );
  return { status: response.status, body: await response.json() };
};

const PERIOD = 'project=Internal&startDate=2026-10-01&endDate=2026-10-31';

describe('GET /api/devops/monthly-checkpoint — customer filter (#7385)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSession.mockResolvedValue({ accessToken: 'token' });
    getTickets.mockResolvedValue([
      ticketFrom(1, 'ann@example.test'),
      ticketFrom(2, 'ann@example.test'),
      ticketFrom(3, 'bo@example.test'),
    ]);
  });

  it('lists every customer in the project with their ticket count', async () => {
    const { status, body } = await get(PERIOD);
    expect(status).toBe(200);
    expect(body.tickets).toHaveLength(3);
    expect(body.customers).toEqual([
      expect.objectContaining({ key: 'ann@example.test', ticketCount: 2 }),
      expect.objectContaining({ key: 'bo@example.test', ticketCount: 1 }),
    ]);
  });

  it("narrows the report to one customer's tickets but keeps the full list", async () => {
    const { status, body } = await get(`${PERIOD}&customer=ANN@example.test`);
    expect(status).toBe(200);
    expect(body.tickets.map((t: { id: number }) => t.id).sort()).toEqual([1, 2]);
    expect(body.customers).toHaveLength(2);
  });

  it('rejects a customer the project has never had', async () => {
    const { status } = await get(`${PERIOD}&customer=nobody@example.test`);
    expect(status).toBe(400);
  });

  it('rejects an unknown query parameter instead of ignoring it', async () => {
    const { status, body } = await get(`${PERIOD}&custmer=ann@example.test`);
    expect(status).toBe(400);
    expect(body.error).toContain('custmer');
    expect(getTickets).not.toHaveBeenCalled();
  });
});
