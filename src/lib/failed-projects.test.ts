import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// A project whose tickets fail to load used to contribute nothing and say
// nothing, so the list read as "no tickets" rather than "some could not be
// loaded" (#509). That silence is what hid #501 for weeks.

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: () => getServerSession() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/devops-auth', () => ({ validateOrganizationAccess: async () => true }));
vi.mock('@/lib/state-categories', () => ({ fetchAndCacheStateCategories: async () => {} }));

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
