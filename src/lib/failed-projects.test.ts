import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// A project whose tickets fail to load used to contribute nothing and say
// nothing, so the list read as "no tickets" rather than "some could not be
// loaded" (#509). That silence is what hid #501 for weeks.

const getServerSession = vi.fn();
vi.mock('@/lib/server-session', () => ({
  getServerSessionWithToken: () => getServerSession(),
}));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/devops-auth', () => ({ validateOrganizationAccess: async () => true }));

const getAllTickets = vi.fn();
vi.mock('@/lib/devops', async () => {
  const actual = await vi.importActual<typeof import('./devops')>('./devops');
  return {
    ...actual,
    AzureDevOpsService: class {
      organizationName = 'KnowAll';
      getAllTickets = getAllTickets;
    },
  };
});

const get = async () => {
  const { GET } = await import('@/app/api/devops/tickets/route');
  return GET(
    new NextRequest('https://zapdesk.test/api/devops/tickets?view=all-active', {
      headers: { 'x-devops-org': 'KnowAll' },
    })
  );
};

describe('GET /api/devops/tickets reports projects it could not read (#509)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The route loads state categories with its own fetch to Azure DevOps.
    // Without a stub every run made a live request and logged its failure.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ value: [] }), { status: 200 }))
    );
    getServerSession.mockResolvedValue({ accessToken: 'token', user: { email: 'a@b.test' } });
  });

  it('names the projects that failed', async () => {
    getAllTickets.mockResolvedValue({
      tickets: [],
      failedProjects: ['ABC Inc (Agile)', 'Contoso Ltd (Basic)'],
    });

    const body = await (await get()).json();

    expect(body.failedProjects).toEqual(['ABC Inc (Agile)', 'Contoso Ltd (Basic)']);
  });

  it('leaves the key out entirely when every project was read', async () => {
    // Its presence is the signal that a list is incomplete, so a healthy
    // response must not carry an empty array that callers would have to
    // remember to check the length of.
    getAllTickets.mockResolvedValue({ tickets: [], failedProjects: [] });

    const body = await (await get()).json();

    expect('failedProjects' in body).toBe(false);
  });

  it('still returns the tickets it did manage to read', async () => {
    // Partial beats nothing: the engineer sees what exists, plus a warning.
    getAllTickets.mockResolvedValue({
      tickets: [
        {
          id: 1,
          title: 'Printer jammed',
          status: 'New',
          createdAt: new Date('2026-10-01'),
          updatedAt: new Date('2026-10-02'),
        },
      ],
      failedProjects: ['Contoso Ltd (Basic)'],
    });

    const response = await get();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tickets).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.failedProjects).toEqual(['Contoso Ltd (Basic)']);
  });
});

const call = async (path: string) => {
  const { GET } = await import(`@/app/api/devops/${path}/route`);
  return GET(
    new NextRequest(`https://zapdesk.test/api/devops/${path}`, {
      headers: { 'x-devops-org': 'KnowAll' },
    })
  );
};

describe('analytics routes say when projects could not be read (#509)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ value: [] }), { status: 200 }))
    );
    getServerSession.mockResolvedValue({ accessToken: 'token', user: { email: 'a@b.test' } });
  });

  it('stats names the failed projects and claims no compliance rate when nothing loaded', async () => {
    getAllTickets.mockResolvedValue({ tickets: [], failedProjects: ['Contoso Ltd (Basic)'] });

    const body = await (await call('stats')).json();

    expect(body.failedProjects).toEqual(['Contoso Ltd (Basic)']);
    // Not 100%: the empty list is what failed, not a clean record.
    expect(body.sla.complianceRate).toBeNull();
  });

  it('stats keeps its old shape and 100% when every project loaded and nothing is open', async () => {
    getAllTickets.mockResolvedValue({ tickets: [], failedProjects: [] });

    const body = await (await call('stats')).json();

    expect('failedProjects' in body).toBe(false);
    expect(body.sla.complianceRate).toBe(100);
  });

  it('sla-status names the failed projects', async () => {
    getAllTickets.mockResolvedValue({ tickets: [], failedProjects: ['Contoso Ltd (Basic)'] });

    const body = await (await call('sla-status')).json();

    expect(body.failedProjects).toEqual(['Contoso Ltd (Basic)']);
  });

  it('sla-status leaves the key out when every project loaded', async () => {
    getAllTickets.mockResolvedValue({ tickets: [], failedProjects: [] });

    const body = await (await call('sla-status')).json();

    expect('failedProjects' in body).toBe(false);
  });
});
