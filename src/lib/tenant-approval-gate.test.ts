import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import { authOptions } from './auth';
import { KNOWALL_TENANT_ID } from './tenant-approval';

// Approved organisations only, enforced on the server: the session callback,
// the proxy, API routes and the install callback. Sessions here come from the
// real session callback, so the routes see exactly what they would in
// production.

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: () => getServerSession() }));

const getToken = vi.fn();
vi.mock('next-auth/jwt', () => ({ getToken: (...args: unknown[]) => getToken(...args) }));

const validateOrganizationAccess = vi.fn();
vi.mock('@/lib/devops-auth', () => ({
  validateOrganizationAccess: (...args: unknown[]) => validateOrganizationAccess(...args),
}));

const getAllTickets = vi.fn();
vi.mock('@/lib/devops', () => ({
  AzureDevOpsService: class {
    findWorkItemById = vi.fn();
    getAllTickets = async () => ({ tickets: await getAllTickets(), failedProjects: [] });
    getProjects = vi.fn(async () => []);
    getTeamMembers = vi.fn(async () => []);
  },
}));

const CUSTOMER = '11111111-2222-4333-8444-555555555555';
const STRANGER = '99999999-8888-4777-8666-555555555555';

const fetchMock = vi.fn();

/** What the real session callback makes of a token from tenant `tid`. */
async function sessionFrom(tid: string | undefined): Promise<Session> {
  const token: JWT = { tenantId: tid, accessToken: 'devops-token', refreshToken: 'refresh' };
  const session: Session = {
    user: { id: 'u1', name: 'Alex Morgan', email: 'alex.morgan@contoso.example' },
    expires: '2099-01-01T00:00:00.000Z',
  };
  const callback = authOptions.callbacks!.session!;
  return (await callback({ session, token } as Parameters<typeof callback>[0])) as Session;
}

async function proxyFor(path: string, tid: string | undefined | null) {
  getToken.mockResolvedValue(tid === null ? null : { tenantId: tid });
  const { proxy } = await import('@/proxy');
  return proxy(new NextRequest(new URL(path, 'https://zapdesk.test')));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('APPROVED_TENANT_IDS', CUSTOMER);
  vi.stubEnv('AZURE_AD_TENANT_ID', KNOWALL_TENANT_ID);
  vi.stubEnv('NEXTAUTH_URL', 'https://zapdesk.test');
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('session callback', () => {
  it('gives an approved tenant its Azure DevOps token', async () => {
    for (const tid of [KNOWALL_TENANT_ID, CUSTOMER]) {
      const session = await sessionFrom(tid);
      expect(session.tenantApproved).toBe(true);
      expect(session.accessToken).toBe('devops-token');
    }
  });

  it('keeps every token out of an unapproved session', async () => {
    const session = await sessionFrom(STRANGER);
    expect(session.tenantApproved).toBe(false);
    expect(session.accessToken).toBeUndefined();
    expect(session.refreshToken).toBeUndefined();
    expect(session.tenantId).toBe(STRANGER);
  });

  it('blocks a session with no tid', async () => {
    const session = await sessionFrom(undefined);
    expect(session.tenantApproved).toBe(false);
    expect(session.accessToken).toBeUndefined();
  });
});

describe('proxy', () => {
  it('lets an approved tenant through to pages and APIs', async () => {
    for (const path of ['/', '/tickets', '/api/devops/tickets']) {
      const response = await proxyFor(path, CUSTOMER);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('location')).toBeNull();
    }
  });

  it('answers an unapproved tenant 403 from every API route', async () => {
    for (const path of [
      '/api/devops/tickets',
      '/api/devops/accounts',
      '/api/lightning',
      '/api/profile/github',
      '/api/devops/attachments/abc/report.pdf',
    ]) {
      const response = await proxyFor(path, STRANGER);
      expect(response.status, path).toBe(403);
    }
  });

  it('sends an unapproved tenant from every page to /not-approved', async () => {
    for (const path of ['/', '/tickets/42', '/admin']) {
      const response = await proxyFor(path, STRANGER);
      expect(response.status, path).toBe(307);
      expect(response.headers.get('location')).toBe('https://zapdesk.test/not-approved');
    }
  });

  it('blocks a token with no tid the same way', async () => {
    expect((await proxyFor('/api/devops/tickets', undefined)).status).toBe(403);
    expect((await proxyFor('/tickets', undefined)).headers.get('location')).toBe(
      'https://zapdesk.test/not-approved'
    );
  });

  it('still lets an unapproved tenant sign out, install and see the page', async () => {
    for (const path of ['/not-approved', '/login', '/api/auth/signout', '/api/install/callback']) {
      expect((await proxyFor(path, STRANGER)).status, path).toBe(200);
    }
    expect((await proxyFor('/og-image.png', STRANGER)).status).toBe(200);
  });

  it('leaves signed-out requests to the existing handling', async () => {
    expect((await proxyFor('/api/devops/tickets', null)).status).toBe(200);
  });

  it('sends an approved person away from /not-approved', async () => {
    const response = await proxyFor('/not-approved', KNOWALL_TENANT_ID);
    expect(response.headers.get('location')).toBe('https://zapdesk.test/');
  });
});

describe('API routes', () => {
  const searchAs = async (session: Session) => {
    getServerSession.mockResolvedValue(session);
    const { GET } = await import('@/app/api/devops/search/route');
    const url = new URL('https://zapdesk.test/api/devops/search?q=login');
    return GET(new NextRequest(url, { headers: { 'x-devops-org': 'Contoso' } }));
  };

  it('returns no data to an unapproved tenant from a DevOps route (401)', async () => {
    const response = await searchAs(await sessionFrom(STRANGER));
    expect(response.status).toBe(401);
    expect(validateOrganizationAccess).not.toHaveBeenCalled();
    expect(getAllTickets).not.toHaveBeenCalled();
  });

  it('returns 403 to an unapproved tenant from a Graph-backed route', async () => {
    getServerSession.mockResolvedValue(await sessionFrom(STRANGER));
    const { GET } = await import('@/app/api/lightning/route');
    const response = await GET();
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still applies the per-user organisation access rule to an approved tenant', async () => {
    validateOrganizationAccess.mockResolvedValue(false);
    const response = await searchAs(await sessionFrom(CUSTOMER));
    expect(response.status).toBe(403);
    expect(validateOrganizationAccess).toHaveBeenCalledWith('devops-token', 'Contoso');
    expect(getAllTickets).not.toHaveBeenCalled();
  });

  it('serves an approved tenant whose user has access', async () => {
    validateOrganizationAccess.mockResolvedValue(true);
    getAllTickets.mockResolvedValue([]);
    const response = await searchAs(await sessionFrom(CUSTOMER));
    expect(response.status).toBe(200);
  });
});

describe('install callback', () => {
  const callback = async (tenant: string) => {
    const { GET } = await import('@/app/api/install/callback/route');
    const url = new URL('https://zapdesk.test/api/install/callback');
    url.searchParams.set('state', 'abc');
    url.searchParams.set('admin_consent', 'True');
    url.searchParams.set('tenant', tenant);
    const request = new NextRequest(url, { headers: { cookie: 'zapdesk_install_state=abc' } });
    return (await GET(request)).headers.get('location');
  };

  it('sends a newly installed, unapproved tenant to "installed, pending approval"', async () => {
    expect(await callback(STRANGER)).toBe(
      `https://zapdesk.test/not-approved?installed=1&tenant=${STRANGER}`
    );
  });

  it('still invites an approved tenant to sign in', async () => {
    expect(await callback(CUSTOMER)).toBe('https://zapdesk.test/install?result=installed');
  });
});
