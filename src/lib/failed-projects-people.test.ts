import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The routes behind the Team, Users and search views drop `failedProjects`
 * (#516). Each one answers from `getAllTickets()`, so a project that fails to
 * load makes every figure short -- and short in a way that reads as fact: a
 * person who resolved nothing, a user who does not exist, a search with no
 * match. The counts were the half of #509 that never got finished.
 */

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: () => getServerSession() }));
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
      // Everything else these routes reach for, answering empty so the test
      // turns on the tickets alone.
      getProjects = async () => [];
      getTeamMembers = async () => [];
      getOrganizationUsers = async () => [];
      getAllUsersWithEntitlements = async () => [];
      getGitActivity = async () => [];
      findWorkItemById = async () => null;
    },
  };
});

const call = async (path: string, query = '') => {
  const { GET } = await import(`@/app/api/devops/${path}/route`);
  return GET(
    new NextRequest(`https://zapdesk.test/api/devops/${path}${query}`, {
      headers: { 'x-devops-org': 'KnowAll' },
    })
  );
};

const FAILED = ['Contoso Ltd (Basic)'];

// path -> the query string it needs, if any
const ROUTES: [string, string][] = [
  ['users', ''],
  ['team', ''],
  ['team-activity', ''],
  ['search', '?q=printer'],
];

describe('the people and search routes report projects they could not read (#516)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ value: [] }), { status: 200 }))
    );
    getServerSession.mockResolvedValue({ accessToken: 'token', user: { email: 'a@b.test' } });
  });

  for (const [path, query] of ROUTES) {
    it(`${path} names the projects that failed`, async () => {
      getAllTickets.mockResolvedValue({ tickets: [], failedProjects: FAILED });

      const body = await (await call(path, query)).json();

      expect(body.failedProjects).toEqual(FAILED);
    });

    it(`${path} leaves the key out entirely when every project was read`, async () => {
      // Its presence is the signal, so a healthy response must not carry an
      // empty array that every caller would have to check the length of.
      getAllTickets.mockResolvedValue({ tickets: [], failedProjects: [] });

      const body = await (await call(path, query)).json();

      expect('failedProjects' in body).toBe(false);
    });
  }

  it('still answers with what it did manage to read', async () => {
    // Partial beats nothing: the page shows what exists, plus the warning.
    getAllTickets.mockResolvedValue({ tickets: [], failedProjects: FAILED });

    const response = await call('users');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(body.users)).toBe(true);
    expect(body.failedProjects).toEqual(FAILED);
  });
});
