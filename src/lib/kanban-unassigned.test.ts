import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AzureDevOpsService } from './devops';
import { boardGitHubTickets } from './github-kanban';
import { gitHubUserToPerson } from './github-issues';
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

  it('keeps an issue whose assignee maps to no DevOps person', () => {
    // Build the assignee through the real mapper rather than asserting what it
    // returns: with no user map it falls back to the GitHub identity, so the
    // ticket still has an assignee and `regroupByPerson` heads a column with
    // the login. Hiding that card would drop work somebody owns.
    const unmapped = gitHubUserToPerson({ id: 42, login: 'alexmorgan' }, undefined);
    expect(unmapped.displayName).toBe('alexmorgan');

    expect(boardGitHubTickets([ticket(9, unmapped)], false).map((t) => t.id)).toEqual([9]);
  });
});

// The GitHub half of the board's closed window (#6713). It has to agree with
// the DevOps half: the two sources sit in one column, and a fortnight of one
// beside a week of the other would be two stories about the same question.
describe('GitHub issues and the closed window', () => {
  const alex = { displayName: 'Alex Morgan' } as User;
  const closed = (id: number, resolvedAt?: string): Ticket =>
    ({
      id,
      title: `Issue ${id}`,
      assignee: alex,
      status: 'Closed',
      ...(resolvedAt ? { resolvedAt: new Date(resolvedAt) } : {}),
    }) as Ticket;
  const open = (id: number): Ticket =>
    ({ id, title: `Issue ${id}`, assignee: alex, status: 'Open' }) as Ticket;

  const floor = '2026-10-21';

  it('drops an issue closed before the window', () => {
    expect(boardGitHubTickets([closed(1, '2026-10-20T23:59:59Z')], true, floor)).toHaveLength(0);
  });

  it('keeps an issue closed inside the window', () => {
    expect(
      boardGitHubTickets([closed(1, '2026-10-30T09:00:00Z')], true, floor).map((t) => t.id)
    ).toEqual([1]);
  });

  // The boundary the acceptance criteria names: the first moment of the first
  // day is inside.
  it('keeps an issue closed exactly on the boundary', () => {
    expect(
      boardGitHubTickets([closed(1, `${floor}T00:00:00Z`)], true, floor).map((t) => t.id)
    ).toEqual([1]);
  });

  // GitHub's `since` filters on the last update, so a long-closed issue
  // commented on yesterday is fetched. It must not then appear as recently
  // closed -- the same mistake the DevOps side made by reading ChangedDate.
  it('drops a long-closed issue that was updated recently', () => {
    expect(boardGitHubTickets([closed(1, '2026-05-15T09:00:00Z')], true, floor)).toHaveLength(0);
  });

  it('keeps every closed issue when there is no floor', () => {
    const tickets = [closed(1, '2021-01-04T09:00:00Z'), closed(2, '2026-10-30T09:00:00Z')];
    expect(boardGitHubTickets(tickets, true, null).map((t) => t.id)).toEqual([1, 2]);
  });

  // Only closed issues are windowed. An open one has no closed date, and a
  // Resolved one waits on a person, so age is a reason to show it (#518).
  it('never windows an open or resolved issue', () => {
    const resolved = { ...closed(2, '2021-01-04T09:00:00Z'), status: 'Resolved' } as Ticket;
    expect(boardGitHubTickets([open(1), resolved], true, floor).map((t) => t.id)).toEqual([1, 2]);
  });

  // Nothing to judge by: keep it, as the DevOps filter keeps an item it cannot
  // judge rather than hiding live work.
  it('keeps a closed issue with no closed date', () => {
    expect(boardGitHubTickets([closed(1)], true, floor).map((t) => t.id)).toEqual([1]);
  });

  // The upper bound, which the DevOps side has always applied. Without it a
  // board asked for an earlier date keeps a GitHub issue closed *after* that
  // date, while the DevOps half of the same column drops it -- the two sources
  // disagreeing about the one question the column asks (#603 review).
  const end = '2026-11-04';

  it('drops an issue closed after the board day', () => {
    expect(boardGitHubTickets([closed(1, '2026-11-05T09:00:00Z')], true, floor, end)).toHaveLength(
      0
    );
  });

  it('keeps an issue closed on the board day itself', () => {
    expect(
      boardGitHubTickets([closed(1, '2026-11-03T23:59:59Z')], true, floor, end).map((t) => t.id)
    ).toEqual([1]);
  });

  // Exclusive: the end day is the day *after* the board's, so the first moment
  // of it is already outside.
  it('drops an issue closed at the first moment of the end day', () => {
    expect(boardGitHubTickets([closed(1, `${end}T00:00:00Z`)], true, floor, end)).toHaveLength(0);
  });

  // "All" has no floor but still has a ceiling, exactly as the DevOps query does.
  it('bounds All above even though it has no floor', () => {
    const tickets = [closed(1, '2019-03-04T09:00:00Z'), closed(2, '2026-11-05T09:00:00Z')];
    expect(boardGitHubTickets(tickets, true, null, end).map((t) => t.id)).toEqual([1]);
  });

  // Today's board passes no ceiling, and then nothing is bounded above.
  it('bounds nothing above when no end day is given', () => {
    expect(
      boardGitHubTickets([closed(1, '2026-11-05T09:00:00Z')], true, floor).map((t) => t.id)
    ).toEqual([1]);
  });

  // Both rules at once: the window must not quietly readmit unassigned work.
  it('still leaves out unassigned work inside the window', () => {
    const unowned = { ...closed(2, '2026-10-30T09:00:00Z'), assignee: undefined } as Ticket;
    expect(
      boardGitHubTickets([closed(1, '2026-10-30T09:00:00Z'), unowned], false, floor).map(
        (t) => t.id
      )
    ).toEqual([1]);
  });
});
