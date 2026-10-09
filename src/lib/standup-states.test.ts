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
  // the 7-day closed window and drop off the board (#436).
  it('keeps Resolved out of the 7-day closed window', () => {
    const { closedStates, openStates } = partitionStandupStates(FLAT, new Set(), PER_TYPE);
    expect(closedStates).toEqual(['Closed']);
    expect(openStates).toContain('Resolved');
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
      const { closedStates, openStates } = partitionStandupStates(FLAT, new Set(), perType);
      expect(closedStates).toEqual(['Closed']);
      expect(openStates).toContain('Resolved');
    }
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
  project = 'Internal'
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
});

describe('getStandupData query flow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Answers each WIQL query with the ids listed for the first state it
  // mentions, and the batch fetch with the matching items.
  function stubDevOps(idsByState: Record<string, number[]>, items: DevOpsWorkItem[]) {
    const wiqlBodies: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
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

  it('fetches an old Resolved item through the 90-day query', async () => {
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
    expect(doneQuery).toContain(">= '2026-10-03'");
    expect(doneQuery).toContain("< '2026-10-10'");
    const activeQuery = wiql.find((q) => q.includes("'Resolved'"));
    expect(activeQuery).toContain(">= '2026-07-11'");
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
});
