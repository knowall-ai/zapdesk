import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AzureDevOpsService } from './devops';
import { boardGitHubTickets } from './github-kanban';
import type { Ticket, User } from '@/types';

/**
 * The board leaves out work nobody owns (#581, #530). What matters is *where*
 * it is left out: in the WIQL, so the ids are never returned and their fields
 * are never hydrated. Filtering in the browser would have left the slow part --
 * the query and the batched field reads -- exactly as it was, which is the
 * whole reason the issue was raised.
 */

const fetchMock = vi.fn();

/** Every WIQL query body the call sent, in order. */
function wiqlQueries(): string[] {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes('/_apis/wit/wiql'))
    .map(([, init]) => JSON.parse((init as RequestInit).body as string).query as string);
}

const CATEGORIES = {
  Closed: 'Completed',
  Active: 'InProgress',
  Resolved: 'Resolved',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  // No ids come back, so the call stops after the three queries -- which is all
  // this test is about.
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ workItems: [] }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Kanban board queries', () => {
  const service = () => new AzureDevOpsService('token', 'Contoso');

  it('asks Azure DevOps only for work that has an assignee', async () => {
    await service().getStandupData(new Date('2026-10-28'), CATEGORIES, undefined, true, false);

    const queries = wiqlQueries();
    expect(queries).toHaveLength(3);
    // All three: recently closed, active, and resolved. Leaving it off any one
    // of them would let that column fetch the whole organisation's backlog.
    for (const query of queries) {
      expect(query).toContain("AND [System.AssignedTo] <> ''");
    }
  });

  it('asks for everything when unassigned work is wanted', async () => {
    await service().getStandupData(new Date('2026-10-28'), CATEGORIES, undefined, true, true);

    const queries = wiqlQueries();
    expect(queries).toHaveLength(3);
    for (const query of queries) {
      expect(query).not.toContain('System.AssignedTo] <>');
    }
  });

  it('includes unassigned work by default, so only the board asks for less', async () => {
    // The method on its own still answers "all the work" -- the narrowing is
    // the board's choice, made in the route from a query parameter.
    await service().getStandupData(new Date('2026-10-28'), CATEGORIES);

    for (const query of wiqlQueries()) {
      expect(query).not.toContain('System.AssignedTo] <>');
    }
  });

  it('still selects the assignee field, which the board groups by', async () => {
    await service().getStandupData(new Date('2026-10-28'), CATEGORIES, undefined, true, false);

    // Filtering on a field and selecting it are different things: the person
    // columns are built from this value.
    for (const query of wiqlQueries()) {
      expect(query).toContain('System.AssignedTo');
    }
  });
});

describe('GitHub issues on the board', () => {
  const ticket = (id: number, assignee?: User): Ticket =>
    ({ id, title: `Issue ${id}`, assignee }) as Ticket;

  const alex = { displayName: 'Alex Morgan' } as User;

  it('leaves out issues nobody is assigned to', () => {
    const tickets = [ticket(1, alex), ticket(2), ticket(3, alex)];

    expect(boardGitHubTickets(tickets, false).map((t) => t.id)).toEqual([1, 3]);
  });

  it('keeps them all when unassigned work is wanted', () => {
    const tickets = [ticket(1, alex), ticket(2)];

    expect(boardGitHubTickets(tickets, true)).toHaveLength(2);
  });

  it('treats an issue whose assignee could not be mapped as unassigned', () => {
    // A GitHub login ZapDesk cannot match to a DevOps person reaches the board
    // with no assignee. The board groups by person, so there is nobody to group
    // it under -- counting it as owned would put it in a column under a name
    // that does not exist.
    expect(boardGitHubTickets([ticket(9, undefined)], false)).toEqual([]);
  });
});
