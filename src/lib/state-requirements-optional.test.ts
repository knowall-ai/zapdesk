import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// GET /api/devops/tickets/[id]/state-requirements with the approval rule
// switched off: the fields are offered as optional, not required. Only the
// network is mocked, answered by URL.

const getServerSession = vi.fn();
vi.mock('@/lib/server-session', () => ({
  getServerSessionWithToken: () => getServerSession(),
}));
vi.mock('@/lib/devops-auth', () => ({ validateOrganizationAccess: async () => true }));

const approvalRule = (isDisabled: boolean) => ({
  name: 'Approval Needed',
  isDisabled,
  conditions: [{ field: 'System.State', conditionType: 'whenNot', value: 'New' }],
  actions: [
    { actionType: 'makeRequired', targetField: 'Custom.ApprovedDate' },
    { actionType: 'makeRequired', targetField: 'Custom.ApprovedBy' },
  ],
});

let rules: unknown[] = [];

const json = (body: unknown) => new Response(JSON.stringify(body));

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/_apis/wit/workitems/7')) {
    return json({ fields: { 'System.State': 'To Do', 'System.WorkItemType': 'Bug' } });
  }
  if (url.includes('/_apis/projects/Contoso')) return json({ id: 'p1' });
  if (url.includes('/_apis/projects/p1/properties')) {
    return json({ value: [{ name: 'System.ProcessTemplateType', value: 'proc1' }] });
  }
  if (url.endsWith('/workitemtypes?api-version=7.0')) {
    return json({ value: [{ name: 'Bug', referenceName: 'Contoso.Bug' }] });
  }
  if (url.includes('/rules?')) return json({ value: rules });
  if (url.includes('/_apis/wit/fields/Custom.ApprovedBy')) {
    return json({ name: 'Approved By', type: 'string', isIdentity: true });
  }
  if (url.includes('/_apis/wit/fields/Custom.ApprovedDate')) {
    return json({ name: 'Approved Date', type: 'dateTime' });
  }
  return new Response('{}', { status: 404 });
});

const lookup = async () => {
  const { GET } = await import('@/app/api/devops/tickets/[id]/state-requirements/route');
  const request = new NextRequest(
    'https://zapdesk.test/api/devops/tickets/7/state-requirements?to=Active&project=Contoso',
    { headers: { 'x-devops-org': 'KnowAllTest' } }
  );
  const response = await GET(request, { params: Promise.resolve({ id: '7' }) });
  return (await response.json()) as {
    fields: { referenceName: string; optional?: boolean; isIdentity?: boolean }[];
  };
};

describe('state requirements with approval switched off', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSession.mockResolvedValue({ accessToken: 'token' });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers Approved By and Approved Date as optional', async () => {
    rules = [approvalRule(true)];
    const { fields } = await lookup();

    expect(fields.map((f) => [f.referenceName, f.optional])).toEqual([
      ['Custom.ApprovedBy', true],
      ['Custom.ApprovedDate', true],
    ]);
    expect(fields[0].isIdentity).toBe(true);
  });

  it('still requires them while the rule is live', async () => {
    rules = [approvalRule(false)];
    const { fields } = await lookup();

    expect(fields.map((f) => [f.referenceName, f.optional])).toEqual([
      ['Custom.ApprovedBy', undefined],
      ['Custom.ApprovedDate', undefined],
    ]);
  });

  it('asks for nothing without the rule', async () => {
    rules = [];
    expect((await lookup()).fields).toEqual([]);
  });
});
