import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getTemplateConfig } from '@/config/process-templates';

/**
 * Which work item type a created ticket gets (#7379).
 *
 * The report was "default is still task". The fix for it changed the sidebar
 * dialog to start with no type, but two things underneath still produced a
 * Task: the Monthly Checkpoint dialog never sent a type at all, and the server
 * substituted a hard-coded `'Task'` for a missing one.
 *
 * Task is a real configured default -- it is T-Minus-15's, the KnowAll process
 * -- but it is not every project's: Agile and Basic default to Issue, Scrum to
 * Product Backlog Item, the Support Ticket process to Ticket. The value was
 * never the mistake; applying one project's answer to all of them was.
 *
 * This covers the server half: given no type, the project's own configured
 * default is used, and a failure to read the project's template does not take
 * the ticket with it.
 *
 * DevOps is mocked at the service boundary, with the real `workItemToTicket`
 * kept, so the response is built exactly as in production.
 */

const getServerSession = vi.fn();
vi.mock('@/lib/server-session', () => ({
  getServerSessionWithToken: () => getServerSession(),
}));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const createTicketWithAssignee = vi.fn();
const getProjectProcessTemplate = vi.fn();
vi.mock('@/lib/devops', async () => {
  const actual = await vi.importActual<typeof import('./devops')>('./devops');
  return {
    ...actual,
    AzureDevOpsService: class {
      organizationName = 'KnowAll';
      createTicketWithAssignee = createTicketWithAssignee;
      getProjectProcessTemplate = getProjectProcessTemplate;
    },
  };
});

vi.mock('@/lib/devops-auth', () => ({
  validateOrganizationAccess: async () => true,
}));

const createdWorkItem = {
  id: 4242,
  fields: {
    'System.Title': 'Printer on the second floor is jamming',
    'System.State': 'New',
    'System.WorkItemType': 'Issue',
    'System.TeamProject': 'Internal',
    'System.Tags': 'ticket',
    'System.CreatedBy': { id: 'u1', displayName: 'Dana', uniqueName: 'dana@example.test' },
    'System.CreatedDate': '2026-10-01T00:00:00Z',
    'System.ChangedDate': '2026-10-01T00:00:00Z',
  },
};

const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/devops/tickets/route');
  return POST(
    new NextRequest('https://zapdesk.test/api/devops/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-devops-org': 'KnowAll' },
      body: JSON.stringify(body),
    })
  );
};

/** The type the service was actually asked to create. */
const typeCreated = () =>
  (createTicketWithAssignee.mock.calls[0]?.[3] as { workItemType?: string } | undefined)
    ?.workItemType;

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({
    accessToken: 'token',
    user: { name: 'Dana Shaw', email: 'dana@example.test' },
  });
  createTicketWithAssignee.mockResolvedValue(createdWorkItem);
  getProjectProcessTemplate.mockResolvedValue('Agile');
});

describe('the work item type a created ticket gets', () => {
  it('uses the type the caller chose', async () => {
    await post({ project: 'Internal', title: 'Printer', workItemType: 'Enhancement' });
    expect(typeCreated()).toBe('Enhancement');
  });

  it('trims a type rather than treating the spaces as a choice', async () => {
    await post({ project: 'Internal', title: 'Printer', workItemType: '  Bug  ' });
    expect(typeCreated()).toBe('Bug');
  });

  it('never reads the project template when a type was given', async () => {
    await post({ project: 'Internal', title: 'Printer', workItemType: 'Bug' });
    expect(getProjectProcessTemplate).not.toHaveBeenCalled();
  });

  // The bug: hard-coding Task applied one template's answer to every project.
  // Task is Agile's business only insofar as Agile does not use it -- Agile
  // configures Issue.
  it('falls back to the project template default, not to Task', async () => {
    getProjectProcessTemplate.mockResolvedValue('Agile');
    await post({ project: 'Internal', title: 'Printer' });
    expect(typeCreated()).toBe('Issue');
  });

  it('uses Scrum its own default', async () => {
    getProjectProcessTemplate.mockResolvedValue('Scrum');
    await post({ project: 'Internal', title: 'Printer' });
    expect(typeCreated()).toBe('Product Backlog Item');
  });

  // A type that was sent but is not a string is refused, not quietly replaced.
  // Substituting a default for `workItemType: 123` would create a ticket of a
  // type nobody asked for and report success.
  it.each([123, true, { name: 'Bug' }, ['Bug'], null])(
    'refuses %p rather than treating it as absent',
    async (workItemType) => {
      const response = await post({ project: 'Internal', title: 'Printer', workItemType });

      expect(response.status).toBe(400);
      expect(createTicketWithAssignee).not.toHaveBeenCalled();
    }
  );

  it.each(['', '   '])('treats %p as no type given', async (workItemType) => {
    getProjectProcessTemplate.mockResolvedValue('Agile');
    await post({ project: 'Internal', title: 'Printer', workItemType });
    expect(typeCreated()).toBe('Issue');
  });

  // Reading the template is a round trip, and a round trip can fail. It must
  // not take the ticket with it.
  it('still creates the ticket when the template cannot be read', async () => {
    getProjectProcessTemplate.mockRejectedValue(new Error('DevOps unavailable'));

    const response = await post({ project: 'Internal', title: 'Printer' });

    expect(response.status).toBe(200);
    expect(createTicketWithAssignee).toHaveBeenCalledTimes(1);
    // The default template's own configured default, read from the config
    // rather than written out here. For KnowAll's process that is 'Task' --
    // which is the point worth being precise about: Task is right when a
    // template says so, and wrong when it is assumed for every project.
    expect(typeCreated()).toBe(getTemplateConfig(undefined).workItemTypes.defaultTicketType);
  });
});
