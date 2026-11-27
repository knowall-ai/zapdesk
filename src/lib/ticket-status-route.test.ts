import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// PATCH /api/devops/tickets/[id]/status picks the state from the work item
// type's own list, so a refusal from DevOps there is never "the type has no
// such state": it is a rule against the move from the current state (#725).

const getServerSession = vi.fn();
vi.mock('@/lib/server-session', () => ({
  getServerSessionWithToken: () => getServerSession(),
}));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const getWorkItem = vi.fn();
const findProjectForWorkItem = vi.fn();
const getWorkItemTypeStates = vi.fn();
const updateTicketState = vi.fn();
vi.mock('@/lib/devops', async () => {
  const actual = await vi.importActual<typeof import('./devops')>('./devops');
  return {
    ...actual,
    AzureDevOpsService: class {
      getWorkItem = getWorkItem;
      findProjectForWorkItem = findProjectForWorkItem;
      getWorkItemTypeStates = getWorkItemTypeStates;
      updateTicketState = updateTicketState;
    },
  };
});

const { StateValueRefusedError } = await import('./devops');

const REASON = 'TF401320: Rule Error for field State. Error code: InvalidListValue.';

const BUG_STATES = [
  { name: 'New', color: '', category: 'Proposed' },
  { name: 'Active', color: '', category: 'InProgress' },
  { name: 'Resolved', color: '', category: 'Resolved' },
  { name: 'Closed', color: '', category: 'Completed' },
];

const patch = async (id: string, body: unknown) => {
  const { PATCH } = await import('@/app/api/devops/tickets/[id]/status/route');
  const request = new NextRequest(`https://zapdesk.test/api/devops/tickets/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-devops-org': 'Contoso' },
  });
  const response = await PATCH(request, { params: Promise.resolve({ id }) });
  return { status: response.status, body: await response.json() };
};

describe('PATCH /api/devops/tickets/[id]/status, refused by DevOps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getServerSession.mockResolvedValue({ accessToken: 'token' });
    getWorkItem.mockResolvedValue({
      id: 42,
      fields: { 'System.WorkItemType': 'Bug', 'System.State': 'New' },
    });
    getWorkItemTypeStates.mockResolvedValue(BUG_STATES);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a state the type has, refused by a rule, is not reported as unavailable', async () => {
    updateTicketState.mockRejectedValue(new StateValueRefusedError(400, 'Resolved', REASON));
    const { status, body } = await patch('42', { status: 'Resolved', project: 'ABC Inc' });

    expect(updateTicketState).toHaveBeenCalledWith('ABC Inc', 42, 'Resolved');
    expect(status).toBe(400);
    expect(body.error).not.toMatch(/not available/);
    expect(body.error).toBe(`Cannot move this Bug from "New" to "Resolved". ${REASON}`);
    // The list it already read is enough: no second lookup.
    expect(getWorkItemTypeStates).toHaveBeenCalledTimes(1);
  });
});
