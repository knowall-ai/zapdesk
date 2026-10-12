import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level coverage for global search (/api/devops/search), as asked for in
// the review of PR #137 (#142). DevOps is mocked at the service boundary so the
// route's own logic -- auth, validation, matching, ordering -- is what's tested.

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: () => getServerSession() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const validateOrganizationAccess = vi.fn();
vi.mock('@/lib/devops-auth', () => ({
  validateOrganizationAccess: (...args: unknown[]) => validateOrganizationAccess(...args),
}));

const findWorkItemById = vi.fn();
const getAllTickets = vi.fn();
const getProjects = vi.fn();
const getTeamMembers = vi.fn();
vi.mock('@/lib/devops', () => ({
  AzureDevOpsService: class {
    findWorkItemById = findWorkItemById;
    getAllTickets = getAllTickets;
    getProjects = getProjects;
    getTeamMembers = getTeamMembers;
  },
}));

interface SearchResponse {
  results?: { type: string; id: string; title: string; subtitle?: string; url: string }[];
  error?: string;
}

const search = async (q: string | null, org: string | null = 'KnowAll') => {
  const { GET } = await import('@/app/api/devops/search/route');
  const url = new URL('https://zapdesk.test/api/devops/search');
  if (q !== null) url.searchParams.set('q', q);
  const headers: Record<string, string> = {};
  if (org) headers['x-devops-org'] = org;
  const response = await GET(new NextRequest(url, { headers }));
  return { status: response.status, body: (await response.json()) as SearchResponse };
};

const ticket = (id: number, title: string, status = 'Open', description?: string) => ({
  id,
  title,
  status,
  description,
});

describe('GET /api/devops/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getServerSession.mockResolvedValue({ accessToken: 'token' });
    validateOrganizationAccess.mockResolvedValue(true);
    findWorkItemById.mockResolvedValue(null);
    getAllTickets.mockResolvedValue([]);
    getProjects.mockResolvedValue([]);
    getTeamMembers.mockResolvedValue([]);
  });

  describe('authentication and validation', () => {
    it('returns 401 when there is no session', async () => {
      getServerSession.mockResolvedValue(null);
      const { status, body } = await search('printer');
      expect(status).toBe(401);
      expect(body.error).toBe('Unauthorized');
      expect(getAllTickets).not.toHaveBeenCalled();
    });

    it('returns 401 when the session has no access token', async () => {
      getServerSession.mockResolvedValue({ user: { name: 'Someone' } });
      const { status } = await search('printer');
      expect(status).toBe(401);
    });

    it('returns 400 without an organization header', async () => {
      const { status } = await search('printer', null);
      expect(status).toBe(400);
    });

    it('returns 403 when the user cannot access the organization', async () => {
      validateOrganizationAccess.mockResolvedValue(false);
      const { status } = await search('printer');
      expect(status).toBe(403);
      expect(getAllTickets).not.toHaveBeenCalled();
    });

    it.each([[null], [''], ['a'], [' a ']])(
      'returns no results for a query shorter than 2 characters: %j',
      async (q) => {
        const { status, body } = await search(q);
        expect(status).toBe(200);
        expect(body.results).toEqual([]);
        expect(getAllTickets).not.toHaveBeenCalled();
      }
    );
  });

  describe('matching', () => {
    it('finds tickets by title, case-insensitively', async () => {
      getAllTickets.mockResolvedValue([
        ticket(1, 'Printer offline'),
        ticket(2, 'VPN not connecting'),
      ]);
      const { status, body } = await search('PRINTER');
      expect(status).toBe(200);
      expect(body.results).toEqual([
        {
          type: 'ticket',
          id: '1',
          title: 'Printer offline',
          subtitle: '#1 • Open',
          url: '/tickets/1',
          status: 'Open',
        },
      ]);
    });

    it('finds tickets by description', async () => {
      getAllTickets.mockResolvedValue([ticket(3, 'Laptop issue', 'New', 'The printer jams')]);
      const { body } = await search('printer');
      expect(body.results?.map((r) => r.id)).toEqual(['3']);
    });

    it('caps ticket results at 5', async () => {
      getAllTickets.mockResolvedValue(
        Array.from({ length: 8 }, (_, i) => ticket(i + 1, `Printer ${i}`))
      );
      const { body } = await search('printer');
      expect(body.results?.filter((r) => r.type === 'ticket')).toHaveLength(5);
    });

    it('finds projects and team members, ordering tickets, then users, then projects', async () => {
      getAllTickets.mockResolvedValue([ticket(1, 'Acme printer')]);
      getProjects.mockResolvedValue([
        { id: 'p1', name: 'Acme' },
        { id: 'p2', name: 'Other' },
      ]);
      getTeamMembers.mockResolvedValue([
        { id: 'u1', displayName: 'Acme Admin', email: 'admin@acme.test' },
        { id: 'u2', displayName: 'Someone Else', email: 'else@example.test' },
      ]);

      const { body } = await search('acme');

      expect(body.results?.map((r) => `${r.type}:${r.id}`)).toEqual([
        'ticket:1',
        'user:u1',
        'organization:p1',
      ]);
    });

    it('lists a member found in several projects only once', async () => {
      getProjects.mockResolvedValue([
        { id: 'p1', name: 'One' },
        { id: 'p2', name: 'Two' },
      ]);
      getTeamMembers.mockResolvedValue([
        { id: 'u1', displayName: 'Dana Smith', email: 'dana@example.test' },
      ]);
      const { body } = await search('dana');
      expect(body.results?.filter((r) => r.type === 'user')).toHaveLength(1);
    });

    it('returns a direct hit for a numeric work item id without a full scan', async () => {
      findWorkItemById.mockResolvedValue({
        id: 5908,
        fields: {
          'System.Title': 'Quarterly checkpoint',
          'System.State': 'Active',
          'System.WorkItemType': 'Checkpoint',
        },
      });
      const { body } = await search('5908');
      expect(body.results).toEqual([
        {
          type: 'ticket',
          id: '5908',
          title: 'Quarterly checkpoint',
          subtitle: 'Checkpoint #5908 • Active',
          url: '/tickets/5908',
          status: 'Active',
        },
      ]);
      expect(getAllTickets).not.toHaveBeenCalled();
    });

    it('falls back to the ticket scan when the numeric id is not found', async () => {
      getAllTickets.mockResolvedValue([ticket(1234, 'Something')]);
      const { body } = await search('1234');
      expect(findWorkItemById).toHaveBeenCalledWith(1234);
      expect(body.results?.map((r) => r.id)).toEqual(['1234']);
    });
  });

  describe('empty results and errors', () => {
    it('returns an empty list when nothing matches', async () => {
      getAllTickets.mockResolvedValue([ticket(1, 'Printer offline')]);
      getProjects.mockResolvedValue([{ id: 'p1', name: 'Acme' }]);
      const { status, body } = await search('zzz');
      expect(status).toBe(200);
      expect(body.results).toEqual([]);
    });

    it('still returns tickets when fetching team members fails', async () => {
      getAllTickets.mockResolvedValue([ticket(1, 'Printer offline')]);
      getProjects.mockResolvedValue([{ id: 'p1', name: 'Acme' }]);
      getTeamMembers.mockRejectedValue(new Error('boom'));
      const { status, body } = await search('printer');
      expect(status).toBe(200);
      expect(body.results?.map((r) => r.id)).toEqual(['1']);
    });

    it('falls back to the ticket scan when the direct id lookup throws', async () => {
      findWorkItemById.mockRejectedValue(new Error('boom'));
      getAllTickets.mockResolvedValue([ticket(42, 'Answer')]);
      const { status, body } = await search('42');
      expect(status).toBe(200);
      expect(body.results?.map((r) => r.id)).toEqual(['42']);
    });

    it('returns 500 when the ticket scan fails', async () => {
      getAllTickets.mockRejectedValue(new Error('DevOps down'));
      const { status, body } = await search('printer');
      expect(status).toBe(500);
      expect(body.error).toBe('Search failed');
    });
  });
});
