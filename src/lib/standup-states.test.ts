import { describe, it, expect, vi, afterEach } from 'vitest';
import { AzureDevOpsService, isOutsideClosedWindow, partitionStandupStates } from './devops';
import type { DevOpsWorkItem } from '@/types';

// The Agile/T-Minus-15 shape: Resolved is its own category between InProgress
// and Completed.
const FLAT = {
  New: 'Proposed',
  Active: 'InProgress',
  Resolved: 'Resolved',
  Closed: 'Completed',
  Removed: 'Removed',
};

const PER_TYPE = {
  Internal: {
    Bug: { New: 'Proposed', Active: 'InProgress', Resolved: 'Resolved', Closed: 'Completed' },
    Task: { New: 'Proposed', Active: 'InProgress', Closed: 'Completed', Removed: 'Removed' },
  },
};

describe('partitionStandupStates', () => {
  // A resolved item still awaits verification, so it must not be limited to
  // the 7-day closed window and drop off the board (#436) -- nor to the 90-day
  // one, which only postponed that (#518). It gets a query with no date floor.
  it('keeps Resolved out of both windows', () => {
    const { closedStates, openStates, resolvedStates } = partitionStandupStates(
      FLAT,
      new Set(),
      PER_TYPE
    );
    expect(closedStates).toEqual(['Closed']);
    expect(resolvedStates).toEqual(['Resolved']);
    expect(openStates).not.toContain('Resolved');
  });

  it('puts Proposed and InProgress states in the open query', () => {
    const { openStates } = partitionStandupStates(FLAT, new Set(), PER_TYPE);
    expect(openStates).toEqual(expect.arrayContaining(['New', 'Active']));
  });

  it('drops states already excluded as Removed', () => {
    const { closedStates, openStates } = partitionStandupStates(
      FLAT,
      new Set(['Removed']),
      PER_TYPE
    );
    expect([...closedStates, ...openStates]).not.toContain('Removed');
  });

  // The flat map is last-write-wins. If one type calls "Done" Completed and
  // another calls it Resolved, windowing the name would hide the second type's
  // resolved items, so the name stays open.
  it('keeps a name open unless every type agrees it is Completed', () => {
    const flat = { Done: 'Completed' };
    const mixed = {
      A: { Task: { Done: 'Completed' } },
      B: { Bug: { Done: 'Resolved' } },
    };
    const { closedStates, openStates } = partitionStandupStates(flat, new Set(), mixed);
    expect(closedStates).not.toContain('Done');
    expect(openStates).toContain('Done');
  });

  it('windows a name that is Completed for every type', () => {
    const agreed = {
      A: { Task: { Done: 'Completed' } },
      B: { Bug: { Done: 'Completed' } },
    };
    const { closedStates } = partitionStandupStates({ Done: 'Completed' }, new Set(), agreed);
    expect(closedStates).toEqual(['Done']);
  });

  it('falls back to the flat map when per-type data is missing', () => {
    for (const perType of [undefined, {}]) {
      const { closedStates, resolvedStates } = partitionStandupStates(FLAT, new Set(), perType);
      expect(closedStates).toEqual(['Closed']);
      expect(resolvedStates).toEqual(['Resolved']);
    }
  });

  // Mirrors the Completed rule above: windowing is the risk, so a name only
  // escapes the window when every type that defines it agrees.
  it('keeps a name windowed unless every type agrees it is Resolved', () => {
    const mixed = {
      A: { Task: { Done: 'Resolved' } },
      B: { Bug: { Done: 'InProgress' } },
    };
    const { openStates, resolvedStates } = partitionStandupStates(
      { Done: 'Resolved' },
      new Set(),
      mixed
    );
    expect(resolvedStates).not.toContain('Done');
    expect(openStates).toContain('Done');
  });
});

describe('partitionStandupStates with partial discovery', () => {
  // A type that was not discovered may use "Closed" as an open state, so no
  // name can be windowed safely.
  it('sends every name to the 90-day query', () => {
    const { closedStates, openStates } = partitionStandupStates(
      FLAT,
      new Set(['Removed']),
      PER_TYPE,
      false
    );
    expect(closedStates).toEqual([]);
    expect(openStates).toEqual(['New', 'Active', 'Resolved', 'Closed']);
  });

  it('still uses the flat map when there is no per-type data at all', () => {
    const { closedStates } = partitionStandupStates(FLAT, new Set(), undefined, false);
    expect(closedStates).toEqual(['Closed']);
  });
});

function workItem(
  id: number,
  state: string,
  changed: string,
  type = 'Bug',
  project = 'Internal',
  /** Left out to stand for a process that sets no ClosedDate (#6713). */
  closed?: string
): DevOpsWorkItem {
  return {
    id,
    rev: 1,
    url: '',
    fields: {
      'System.State': state,
      'System.ChangedDate': changed,
      'System.WorkItemType': type,
      'System.TeamProject': project,
      ...(closed ? { 'Microsoft.VSTS.Common.ClosedDate': closed } : {}),
    },
  } as unknown as DevOpsWorkItem;
}

describe('isOutsideClosedWindow', () => {
  const start = '2026-10-03';
  const end = '2026-10-10';

  it('flags a closed item changed before the window', () => {
    const item = workItem(1, 'Closed', '2026-09-20T10:00:00Z');
    expect(isOutsideClosedWindow(item, start, end, PER_TYPE)).toBe(true);
  });

  it('flags a closed item changed after the window', () => {
    const item = workItem(1, 'Closed', '2026-10-10T00:00:00Z');
    expect(isOutsideClosedWindow(item, start, end, PER_TYPE)).toBe(true);
  });

  it('keeps a closed item changed inside the window', () => {
    const item = workItem(1, 'Closed', '2026-10-05T10:00:00Z');
    expect(isOutsideClosedWindow(item, start, end, PER_TYPE)).toBe(false);
  });

  it('keeps an old Resolved item', () => {
    const item = workItem(1, 'Resolved', '2026-08-01T10:00:00Z');
    expect(isOutsideClosedWindow(item, start, end, PER_TYPE)).toBe(false);
  });

  it('keeps an item whose type was not discovered', () => {
    const item = workItem(1, 'Closed', '2026-08-01T10:00:00Z', 'Risk');
    expect(isOutsideClosedWindow(item, start, end, PER_TYPE)).toBe(false);
  });

  // The bug exactly as it stood on the live board: task 183 was closed on 15
  // May and edited on 28 October, which put it in a column labelled as the
  // last few days. ChangedDate is inside the window and ClosedDate is not, so
  // this test fails if the filter reads the wrong field (#6713).
  it('judges by the closed date, not the last change', () => {
    const item = workItem(
      183,
      'Closed',
      '2026-10-05T10:00:00Z',
      'Bug',
      'Internal',
      '2026-05-15T09:00:00Z'
    );
    expect(isOutsideClosedWindow(item, start, end, PER_TYPE)).toBe(true);
  });

  // The other direction: closed inside the window, not touched since. Nothing
  // about reading ClosedDate may hide an item that belongs on the board.
  it('keeps an item closed inside the window', () => {
    const item = workItem(
      1,
      'Closed',
      '2026-10-05T10:00:00Z',
      'Bug',
      'Internal',
      '2026-10-04T09:00:00Z'
    );
    expect(isOutsideClosedWindow(item, start, end, PER_TYPE)).toBe(false);
  });

  // The boundary the acceptance criteria names. The window is inclusive of its
  // first day and exclusive of the day after its last.
  it('keeps an item closed exactly on the first moment of the window', () => {
    const item = workItem(
      1,
      'Closed',
      '2026-10-05T10:00:00Z',
      'Bug',
      'Internal',
      `${start}T00:00:00Z`
    );
    expect(isOutsideClosedWindow(item, start, end, PER_TYPE)).toBe(false);
  });

  it('drops an item closed one millisecond before the window', () => {
    const item = workItem(
      1,
      'Closed',
      '2026-10-05T10:00:00Z',
      'Bug',
      'Internal',
      '2026-10-02T23:59:59.999Z'
    );
    expect(isOutsideClosedWindow(item, start, end, PER_TYPE)).toBe(true);
  });

  // "All": no floor, so however old the closed date, the item stays.
  it('keeps an item closed years ago when there is no floor', () => {
    const item = workItem(
      1,
      'Closed',
      '2026-10-05T10:00:00Z',
      'Bug',
      'Internal',
      '2021-01-04T09:00:00Z'
    );
    expect(isOutsideClosedWindow(item, null, end, PER_TYPE)).toBe(false);
  });

  // The upper bound still applies with no floor: a board asked for an earlier
  // date must not show work closed after the day it is showing.
  it('still drops an item closed after the window with no floor', () => {
    const item = workItem(
      1,
      'Closed',
      '2026-10-05T10:00:00Z',
      'Bug',
      'Internal',
      '2026-10-11T09:00:00Z'
    );
    expect(isOutsideClosedWindow(item, null, end, PER_TYPE)).toBe(true);
  });

  // A process that sets no ClosedDate falls back to ChangedDate, which is
  // exactly what this filter did before 6713. Such an organisation sees no
  // change rather than an empty column.
  it('falls back to the last change when no closed date is set', () => {
    expect(
      isOutsideClosedWindow(workItem(1, 'Closed', '2026-09-20T10:00:00Z'), start, end, PER_TYPE)
    ).toBe(true);
    expect(
      isOutsideClosedWindow(workItem(2, 'Closed', '2026-10-05T10:00:00Z'), start, end, PER_TYPE)
    ).toBe(false);
  });
});

describe('getStandupData query flow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Answers each WIQL query with the ids listed for the first state it
  // mentions, and the batch fetch with the matching items.
  function stubDevOps(
    idsByState: Record<string, number[]>,
    items: DevOpsWorkItem[],
    /**
     * What the organisation's field catalogue answers. The batch read is
     * guarded against fields an organisation does not define, so a test that
     * cares which fields are asked for has to say what this org has.
     */
    orgFields: string[] = []
  ) {
    const wiqlBodies: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/_apis/wit/fields')) {
        return new Response(
          JSON.stringify({ value: orgFields.map((referenceName) => ({ referenceName })) })
        );
      }
      if (url.includes('/_apis/wit/wiql')) {
        const query = JSON.parse(String(init?.body)).query as string;
        wiqlBodies.push(query);
        const ids = Object.entries(idsByState)
          .filter(([state]) => query.includes(`'${state}'`))
          .flatMap(([, stateIds]) => stateIds);
        return new Response(JSON.stringify({ workItems: ids.map((id) => ({ id })) }));
      }
      const requested = new URL(url).searchParams.get('ids')?.split(',').map(Number) ?? [];
      return new Response(
        JSON.stringify({ value: items.filter((item) => requested.includes(item.id)) })
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    return wiqlBodies;
  }

  const target = new Date('2026-10-09T12:00:00Z');

  it('asks for Resolved items with no date floor at all', async () => {
    const wiql = stubDevOps({ Resolved: [1], Closed: [2] }, [
      workItem(1, 'Resolved', '2026-08-01T10:00:00Z'),
      workItem(2, 'Closed', '2026-10-08T10:00:00Z'),
    ]);

    const { items } = await new AzureDevOpsService('token', 'org').getStandupData(
      target,
      FLAT,
      PER_TYPE
    );

    expect(items.map((item) => item.id).sort()).toEqual([1, 2]);
    const doneQuery = wiql.find((q) => q.includes("IN ('Closed')"));
    // Fourteen days back from the 9th, inclusive of it, because 6713 asked for
    // a fortnight. It was seven days (>= '2026-10-03') until then.
    expect(doneQuery).toContain(">= '2026-09-26'");
    expect(doneQuery).toContain("< '2026-10-10'");
    // The 90-day floor is what hid 84 items resolved as far back as February
    // (#518). The query that fetches them must carry no ChangedDate bound.
    const resolvedQuery = wiql.find((q) => q.includes("IN ('Resolved')"));
    expect(resolvedQuery).toBeDefined();
    expect(resolvedQuery).not.toContain('ChangedDate] >=');
    expect(resolvedQuery).not.toContain('ChangedDate] <');
    // The open states keep their window: an untouched Active item really is
    // stale, and this is a daily stand-up board.
    const activeQuery = wiql.find((q) => q.includes("IN ('New', 'Active')"));
    expect(activeQuery).toContain(">= '2026-07-11'");
  });

  // The bug exactly as reported: resolved long ago, never closed, nobody can
  // see it. Eight months is well outside the old 90-day floor (#518).
  it('returns a Resolved item last touched eight months ago', async () => {
    stubDevOps({ Resolved: [1] }, [workItem(1, 'Resolved', '2026-02-04T10:00:00Z')]);

    const { items } = await new AzureDevOpsService('token', 'org').getStandupData(
      target,
      FLAT,
      PER_TYPE
    );

    expect(items.map((item) => item.id)).toEqual([1]);
  });

  // A name two types disagree about is windowed, not unwindowed: it goes to
  // the 90-day query, and the per-item check then trims whichever items are
  // Completed for their own type (#436). This is the reachable half of that
  // filter -- an item from the resolved query cannot be Completed for its own
  // type, because a name only escapes the window when every type agrees.
  //
  // Both items sit inside the 90-day window on purpose. A disputed name is
  // not exempt from that floor -- only a name every type agrees is Resolved
  // reaches the query with no floor -- so dating them earlier would assert on
  // a pair the real query could never return.
  it('trims a disputed name per item: Resolved for one type, windowed for the other', async () => {
    const perType = {
      A: { Task: { Done: 'Resolved' } },
      B: { Bug: { Done: 'Completed' } },
    };
    stubDevOps({ Done: [1, 2] }, [
      workItem(1, 'Done', '2026-09-01T10:00:00Z', 'Task', 'A'),
      workItem(2, 'Done', '2026-09-01T10:00:00Z', 'Bug', 'B'),
    ]);

    const { items } = await new AzureDevOpsService('token', 'org').getStandupData(
      target,
      { Done: 'Resolved' },
      perType
    );

    // Both reached the batch. The Task is Resolved for its type, so the
    // 7-day window does not apply to it; the Bug is Completed for its type
    // and 2026-09-01 is outside that window, so it is trimmed.
    expect(items.map((item) => item.id)).toEqual([1]);
  });

  // "Done" is Completed for Task but Resolved for Bug, so nothing is windowed.
  // The board must still show the active items, and only recent closed Tasks.
  it('returns active items when no state can be windowed', async () => {
    const mixed = {
      A: { Task: { Active: 'InProgress', Done: 'Completed' } },
      B: { Bug: { Active: 'InProgress', Done: 'Resolved' } },
    };
    const wiql = stubDevOps({ Active: [1], Done: [2, 3, 4] }, [
      workItem(1, 'Active', '2026-09-01T10:00:00Z', 'Task', 'A'),
      workItem(2, 'Done', '2026-08-01T10:00:00Z', 'Bug', 'B'),
      workItem(3, 'Done', '2026-10-08T10:00:00Z', 'Task', 'A'),
      workItem(4, 'Done', '2026-08-01T10:00:00Z', 'Task', 'A'),
    ]);

    const { items } = await new AzureDevOpsService('token', 'org').getStandupData(
      target,
      { Active: 'InProgress', Done: 'Completed' },
      mixed
    );

    expect(wiql).toHaveLength(1);
    expect(items.map((item) => item.id).sort()).toEqual([1, 2, 3]);
  });
  // "All": the floor leaves the query entirely rather than becoming a very old
  // date. A bound the caller did not ask for is a bound that can be wrong.
  it('asks for closed items with no date floor when given the whole history', async () => {
    const wiql = stubDevOps({ Closed: [1] }, [
      workItem(1, 'Closed', '2026-10-08T10:00:00Z', 'Bug', 'Internal', '2021-03-02T09:00:00Z'),
    ]);

    const { items } = await new AzureDevOpsService('token', 'org').getStandupData(
      target,
      FLAT,
      PER_TYPE,
      true,
      true,
      'all'
    );

    const doneQuery = wiql.find((q) => q.includes("IN ('Closed')"));
    expect(doneQuery).not.toContain('ChangedDate] >=');
    // The upper bound stays: a board asked for an earlier date must not show
    // work closed after it.
    expect(doneQuery).toContain("< '2026-10-10'");
    // And the item closed in 2021 survives the per-item filter, which is the
    // half the query cannot express.
    expect(items.map((item) => item.id)).toEqual([1]);
  });

  // The whole point of 6713, end to end: the same item is on the board under
  // "All" and off it under the fortnight, even though its last change is
  // inside both. Fails if either half of the pair reads ChangedDate.
  it('drops a long-closed item from the bounded window but not from All', async () => {
    const longClosed = () =>
      workItem(183, 'Closed', '2026-10-08T10:00:00Z', 'Bug', 'Internal', '2026-05-15T09:00:00Z');

    stubDevOps({ Closed: [183] }, [longClosed()]);
    const bounded = await new AzureDevOpsService('token', 'org').getStandupData(
      target,
      FLAT,
      PER_TYPE
    );
    expect(bounded.items).toEqual([]);

    stubDevOps({ Closed: [183] }, [longClosed()]);
    const everything = await new AzureDevOpsService('token', 'org').getStandupData(
      target,
      FLAT,
      PER_TYPE,
      true,
      true,
      'all'
    );
    expect(everything.items.map((item) => item.id)).toEqual([183]);
  });

  /** The URL of the batch read, which is where the fields are actually asked for. */
  function batchUrl(): string | undefined {
    return vi
      .mocked(globalThis.fetch)
      .mock.calls.map(([url]) => String(url))
      .find((url) => url.includes('/_apis/wit/workitems?ids='));
  }

  // The field the per-item filter reads has to be fetched, or every item falls
  // back to ChangedDate and the window is silently the old, wrong one.
  // A fresh organisation name per test: the field catalogue is cached per org
  // for an hour and there is no reset, so a shared name would serve one test
  // the other's answer.
  it('fetches the closed date it windows on', async () => {
    stubDevOps(
      { Closed: [1] },
      [workItem(1, 'Closed', '2026-10-08T10:00:00Z')],
      ['Microsoft.VSTS.Common.ClosedDate']
    );

    await new AzureDevOpsService('token', 'has-closed-date').getStandupData(target, FLAT, PER_TYPE);

    expect(batchUrl()).toContain('Microsoft.VSTS.Common.ClosedDate');
  });

  // The other side of that guard. The batch endpoint is all-or-nothing: naming
  // a field the organisation has never defined answers 400 TF51535 and loses
  // every item in the batch -- the whole board, not one column. So the field
  // must be left out, and the board must still come back.
  it('leaves the closed date out for an organisation that does not define it', async () => {
    stubDevOps({ Closed: [1] }, [workItem(1, 'Closed', '2026-10-08T10:00:00Z')], ['System.Title']);

    const { items } = await new AzureDevOpsService('token', 'no-closed-date').getStandupData(
      target,
      FLAT,
      PER_TYPE
    );

    expect(batchUrl()).not.toContain('Microsoft.VSTS.Common.ClosedDate');
    expect(items.map((item) => item.id)).toEqual([1]);
  });

  // WIQL refuses a query matching more than 20,000 items with VS402337 rather
  // than truncating it. "All" removed the date floor from the closed query and
  // so removed what had kept it small, which would have failed the whole board
  // with a 500 -- and kept failing, since the window is remembered in the
  // address. So the ceiling is asked for.
  it('caps every query at the WIQL limit', async () => {
    stubDevOps({ Closed: [1], Resolved: [2], Active: [3] }, [
      workItem(1, 'Closed', '2026-10-08T10:00:00Z'),
    ]);

    await new AzureDevOpsService('token', 'wiql-cap').getStandupData(
      target,
      FLAT,
      PER_TYPE,
      true,
      true,
      'all'
    );

    const wiqlCalls = vi
      .mocked(globalThis.fetch)
      .mock.calls.map(([url]) => String(url))
      .filter((url) => url.includes('/_apis/wit/wiql'));
    expect(wiqlCalls.length).toBeGreaterThan(0);
    for (const url of wiqlCalls) {
      expect(url).toContain('$top=20000');
    }
  });

  // WIQL validates its SELECT list too (400 TF51005), and the ids are all that
  // is ever read from it, so it names nothing but the id.
  it('selects only the id in its WIQL, so no field can fail the query', async () => {
    const wiql = stubDevOps({ Closed: [1] }, [workItem(1, 'Closed', '2026-10-08T10:00:00Z')]);

    await new AzureDevOpsService('token', 'wiql-select').getStandupData(target, FLAT, PER_TYPE);

    for (const query of wiql) {
      expect(query).toContain('SELECT System.Id');
      expect(query).not.toContain('Microsoft.VSTS.');
    }
  });
});
