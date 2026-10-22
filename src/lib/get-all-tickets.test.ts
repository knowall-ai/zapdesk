import { describe, it, expect, vi, afterEach } from 'vitest';
import { AzureDevOpsService } from './devops';

// The route tests mock getAllTickets whole, so this is the test of the part
// that decides which projects failed (#509): the real method, with only the
// network-facing calls stubbed.

const workItem = (id: number, project: string, changed: string) => ({
  id,
  fields: {
    'System.Title': `Ticket ${id}`,
    'System.State': 'New',
    'System.WorkItemType': 'Task',
    'System.TeamProject': project,
    'System.Tags': 'ticket',
    'System.CreatedBy': { id: 'u1', displayName: 'Dana', uniqueName: 'dana@example.test' },
    'System.CreatedDate': '2026-10-01T00:00:00Z',
    'System.ChangedDate': changed,
  },
});

const service = (
  projects: string[],
  tickets: Record<string, ReturnType<typeof workItem>[] | Error>
) => {
  const s = new AzureDevOpsService('token', 'example-org');
  vi.spyOn(s, 'getProjects').mockResolvedValue(
    projects.map((name) => ({ id: `id-${name}`, name })) as never
  );
  // Private, so reached through the instance rather than the type.
  vi.spyOn(
    s as unknown as { projectSLAMap: () => Promise<object> },
    'projectSLAMap'
  ).mockResolvedValue({});
  vi.spyOn(s, 'getTickets').mockImplementation(async (project: string) => {
    const result = tickets[project];
    if (result instanceof Error) throw result;
    return result as never;
  });
  return s;
};

afterEach(() => vi.restoreAllMocks());

describe('AzureDevOpsService.getAllTickets reports projects it could not read (#509)', () => {
  it('names the project that failed and keeps the tickets from the rest', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = service(['Contoso Ltd', 'Fabrikam', 'Northwind'], {
      'Contoso Ltd': [workItem(1, 'Contoso Ltd', '2026-10-02T00:00:00Z')],
      Fabrikam: new Error('Failed to fetch work items: Bad Request'),
      Northwind: [workItem(3, 'Northwind', '2026-10-03T00:00:00Z')],
    });

    const { tickets, failedProjects } = await s.getAllTickets();

    expect(failedProjects).toEqual(['Fabrikam']);
    // Newest first, and nothing from the failed project.
    expect(tickets.map((t) => t.id)).toEqual([3, 1]);
  });

  it('returns an empty list of failures when every project loads', async () => {
    const s = service(['Contoso Ltd', 'Northwind'], {
      'Contoso Ltd': [workItem(1, 'Contoso Ltd', '2026-10-02T00:00:00Z')],
      Northwind: [],
    });

    const { tickets, failedProjects } = await s.getAllTickets();

    expect(failedProjects).toEqual([]);
    expect(tickets).toHaveLength(1);
  });

  it('names every project when they all fail, rather than looking empty', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = service(['Contoso Ltd', 'Northwind'], {
      'Contoso Ltd': new Error('403'),
      Northwind: new Error('500'),
    });

    const { tickets, failedProjects } = await s.getAllTickets();

    expect(tickets).toEqual([]);
    expect(failedProjects).toEqual(['Contoso Ltd', 'Northwind']);
  });
});
