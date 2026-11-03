import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fetchStateMetadata, clearStateMetadataCache } from './state-discovery';
import { BOARD_WORK_ITEM_TYPES } from './board-work-item-types';
import type { AzureDevOpsService } from './devops';

/**
 * State discovery, exercised against a mocked network rather than by reading
 * the source for the shape of it.
 *
 * The thing worth testing is which requests go out: the board filters its
 * query to six work item types, and discovery used to ask about every type in
 * every project -- 591 requests instead of 131 on a real organisation, for
 * answers nothing could read (#4337). Asserting on request URLs is the only
 * way to catch that going back, because the board looks identical either way.
 */

/** The types a project defines: the six the board shows, plus the ones it never can. */
const PROJECT_TYPES = [
  'Task',
  'Bug',
  'Enhancement',
  'Question',
  'Issue',
  'Risk',
  'Epic',
  'Feature',
  'User Story',
  'Test Case',
  'Shared Steps',
  'Code Review Request',
];

const STATES_BY_TYPE: Record<string, { name: string; category: string }[]> = {
  Task: [
    { name: 'Todo', category: 'Proposed' },
    { name: 'Active', category: 'InProgress' },
    { name: 'Closed', category: 'Completed' },
  ],
  Bug: [
    { name: 'New', category: 'Proposed' },
    { name: 'Resolved', category: 'Resolved' },
    { name: 'Closed', category: 'Completed' },
  ],
};
const DEFAULT_STATES = [
  { name: 'New', category: 'Proposed' },
  { name: 'Closed', category: 'Completed' },
];

/** A state only a planning type defines, so it must not reach the flat map. */
const EPIC_ONLY_STATE = { name: 'Portfolio backlog', category: 'Proposed' };

interface Stub {
  urls: () => string[];
  typeRequests: () => string[];
  stateRequests: () => { project: string; type: string }[];
}

function stubDevOps(
  options: {
    projects?: string[];
    /** Status to answer a matching URL with, `'throw'` for a network error. */
    fail?: (url: string) => number | 'throw' | undefined;
  } = {}
) {
  const projects = options.projects ?? ['Internal', 'Contoso Ltd'];
  const calls: string[] = [];

  const fetchMock = vi.fn(async (url: string) => {
    calls.push(String(url));
    const failure = options.fail?.(String(url));
    if (failure === 'throw') throw new TypeError('fetch failed');
    if (typeof failure === 'number') {
      return new Response('{}', { status: failure });
    }

    if (url.includes('/states?')) {
      const type = decodeURIComponent(url.split('/workitemtypes/')[1].split('/states')[0]);
      const states = type === 'Epic' ? [EPIC_ONLY_STATE] : (STATES_BY_TYPE[type] ?? DEFAULT_STATES);
      return new Response(JSON.stringify({ value: states }));
    }
    if (url.includes('/workitemtypes?')) {
      return new Response(JSON.stringify({ value: PROJECT_TYPES.map((name) => ({ name })) }));
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);

  const service = {
    getProjects: async () => projects.map((name) => ({ name })),
  } as unknown as AzureDevOpsService;

  const stub: Stub = {
    urls: () => calls,
    typeRequests: () => calls.filter((u) => u.includes('/workitemtypes?')),
    stateRequests: () =>
      calls
        .filter((u) => u.includes('/states?'))
        .map((u) => ({
          project: decodeURIComponent(u.split('/_apis/')[0].split('/').pop() as string),
          type: decodeURIComponent(u.split('/workitemtypes/')[1].split('/states')[0]),
        })),
  };
  return { service, stub };
}

beforeEach(() => {
  clearStateMetadataCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('which states discovery asks for', () => {
  // The finding this module was extracted to test properly: the board can only
  // show six types, so asking about the rest is round trips for nothing.
  it('asks only about the work item types the board can show', async () => {
    const { service, stub } = stubDevOps();

    await fetchStateMetadata(service, 'token', 'org-a', 'viewer@example.test');

    const asked = new Set(stub.stateRequests().map((r) => r.type));
    expect([...asked].sort()).toEqual([...BOARD_WORK_ITEM_TYPES].sort());
  });

  it.each(['Epic', 'Feature', 'User Story', 'Test Case', 'Shared Steps', 'Code Review Request'])(
    'never asks for the states of %s',
    async (type) => {
      const { service, stub } = stubDevOps();

      await fetchStateMetadata(service, 'token', `org-${type}`, 'viewer@example.test');

      expect(stub.stateRequests().some((r) => r.type === type)).toBe(false);
    }
  );

  it('asks each project for its types exactly once', async () => {
    const { service, stub } = stubDevOps({ projects: ['Internal', 'Contoso Ltd', 'ABC Inc'] });

    await fetchStateMetadata(service, 'token', 'org-c', 'viewer@example.test');

    expect(stub.typeRequests()).toHaveLength(3);
  });

  // 3 projects x 6 board types, not 3 x 12. The ratio is the whole point.
  it('makes one states request per project and board type, and no more', async () => {
    const { service, stub } = stubDevOps({ projects: ['Internal', 'Contoso Ltd', 'ABC Inc'] });

    await fetchStateMetadata(service, 'token', 'org-d', 'viewer@example.test');

    expect(stub.stateRequests()).toHaveLength(3 * BOARD_WORK_ITEM_TYPES.length);
  });

  it('spells the project and type in the URL so a space or slash cannot break it', async () => {
    const { service, stub } = stubDevOps({ projects: ['Contoso Ltd'] });

    await fetchStateMetadata(service, 'token', 'org-e', 'viewer@example.test');

    expect(stub.urls().some((u) => u.includes('Contoso%20Ltd'))).toBe(true);
    expect(stub.urls().some((u) => u.includes('Contoso Ltd'))).toBe(false);
  });
});

describe('what discovery returns', () => {
  it('describes every board type of every project', async () => {
    const { service } = stubDevOps({ projects: ['Internal'] });

    const meta = await fetchStateMetadata(service, 'token', 'org-f', 'viewer@example.test');

    for (const type of BOARD_WORK_ITEM_TYPES) {
      expect(meta.categoriesByProjectType.Internal[type]).toBeDefined();
      expect(meta.statesByProjectType.Internal[type]).toBeDefined();
    }
    expect(meta.discoveryComplete).toBe(true);
  });

  it('keeps the per-type category, which the flat map loses', async () => {
    const { service } = stubDevOps({ projects: ['Internal'] });

    const meta = await fetchStateMetadata(service, 'token', 'org-g', 'viewer@example.test');

    expect(meta.categoriesByProjectType.Internal.Task.Closed).toBe('Completed');
    expect(meta.categoriesByProjectType.Internal.Bug.Resolved).toBe('Resolved');
    expect(meta.categories.Closed).toBe('Completed');
  });

  // A state only a planning type defines cannot reach the board, because the
  // query filters those types out. It must not be in the map either.
  it('leaves out a state only a non-board type defines', async () => {
    const { service } = stubDevOps({ projects: ['Internal'] });

    const meta = await fetchStateMetadata(service, 'token', 'org-h', 'viewer@example.test');

    expect(meta.categories[EPIC_ONLY_STATE.name]).toBeUndefined();
  });
});

describe('when Azure DevOps will not answer', () => {
  // Partial discovery makes the downstream filters fail safe, which among
  // other things hides resolved items older than 90 days. So it must be
  // reported rather than passed off as a complete picture.
  it('reports an incomplete picture when a types read fails', async () => {
    const { service } = stubDevOps({
      projects: ['Internal', 'Contoso Ltd'],
      fail: (url) => (url.includes('Contoso') && url.includes('/workitemtypes?') ? 403 : undefined),
    });

    const meta = await fetchStateMetadata(service, 'token', 'org-i', 'viewer@example.test');

    expect(meta.discoveryComplete).toBe(false);
    // And the project that did answer is still fully described.
    expect(Object.keys(meta.statesByProjectType.Internal)).toHaveLength(
      BOARD_WORK_ITEM_TYPES.length
    );
  });

  it('reports an incomplete picture when one states read fails', async () => {
    const { service } = stubDevOps({
      projects: ['Internal'],
      fail: (url) => (url.includes('/Bug/states') ? 403 : undefined),
    });

    const meta = await fetchStateMetadata(service, 'token', 'org-j', 'viewer@example.test');

    expect(meta.discoveryComplete).toBe(false);
    expect(meta.categoriesByProjectType.Internal.Task).toBeDefined();
  });

  // A 403 is an answer, so it is not retried: repeating it spends the budget
  // and the user's time to learn the same thing.
  it('does not retry a refusal', async () => {
    const { service, stub } = stubDevOps({
      projects: ['Internal'],
      fail: (url) => (url.includes('/Bug/states') ? 403 : undefined),
    });

    await fetchStateMetadata(service, 'token', 'org-k', 'viewer@example.test');

    expect(stub.stateRequests().filter((r) => r.type === 'Bug')).toHaveLength(1);
  });

  it('returns nothing describable when the project list itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 }))
    );
    const service = {
      getProjects: async () => {
        throw new Error('no projects');
      },
    } as unknown as AzureDevOpsService;

    const meta = await fetchStateMetadata(service, 'token', 'org-l', 'viewer@example.test');

    expect(meta.categories).toEqual({});
    expect(meta.discoveryComplete).toBe(false);
  });
});

describe('the per-organisation cache', () => {
  it('reads once and serves the second caller from memory', async () => {
    const { service, stub } = stubDevOps({ projects: ['Internal'] });

    await fetchStateMetadata(service, 'token', 'org-m', 'viewer@example.test');
    const afterFirst = stub.urls().length;
    await fetchStateMetadata(service, 'token', 'org-m', 'viewer@example.test');

    expect(stub.urls().length).toBe(afterFirst);
  });

  // Two organisations have different processes; one must never answer for the
  // other.
  it('keeps organisations apart', async () => {
    const { service, stub } = stubDevOps({ projects: ['Internal'] });

    await fetchStateMetadata(service, 'token', 'org-n', 'viewer@example.test');
    const afterFirst = stub.urls().length;
    await fetchStateMetadata(service, 'token', 'org-o', 'viewer@example.test');

    expect(stub.urls().length).toBeGreaterThan(afterFirst);
  });

  /**
   * The picture is built from `getProjects()`, which is scoped to the caller's
   * token, so it belongs to the caller and not to the organisation. Keyed by
   * organisation alone, the first user through populates it for everyone, and a
   * user who can see fewer projects is handed `allowedStatesByProjectType`
   * naming projects they have no access to. A project here is a customer, so
   * those names are the thing least safe to hand to the wrong person.
   */
  it('does not serve one viewer the picture built for another', async () => {
    const { service, stub } = stubDevOps({ projects: ['Internal'] });

    await fetchStateMetadata(service, 'token', 'org-q', 'alex@example.test');
    const afterAlex = stub.urls().length;
    await fetchStateMetadata(service, 'token', 'org-q', 'sam@example.test');

    expect(stub.urls().length).toBeGreaterThan(afterAlex);
  });

  it('still serves the same viewer from memory', async () => {
    const { service, stub } = stubDevOps({ projects: ['Internal'] });

    await fetchStateMetadata(service, 'token', 'org-r', 'alex@example.test');
    const afterFirst = stub.urls().length;
    await fetchStateMetadata(service, 'token', 'org-r', 'ALEX@example.test');

    // Same person, different capitalisation: still one read.
    expect(stub.urls().length).toBe(afterFirst);
  });

  /**
   * An incomplete picture must not be held for the full hour.
   *
   * Discovery fails safe when it is incomplete: nothing counts as agreed, which
   * hides resolved items older than ninety days, and cards in an undescribed
   * project are refused by every drop target. Holding that for an hour would
   * make one bad minute cost an hour of a wrong board, and would undo the
   * retry this module gained.
   */
  it('holds an incomplete picture briefly and a complete one for long', async () => {
    const failing = stubDevOps({
      projects: ['Internal'],
      fail: (url) => (url.includes('/Bug/states') ? 503 : undefined),
    });

    const partial = await fetchStateMetadata(
      failing.service,
      'token',
      'org-s',
      'alex@example.test'
    );
    expect(partial.discoveryComplete).toBe(false);
    const afterPartial = failing.stub.urls().length;

    // Within the minute it is reused rather than hammering a struggling server.
    await fetchStateMetadata(failing.service, 'token', 'org-s', 'alex@example.test');
    expect(failing.stub.urls().length).toBe(afterPartial);

    // Past the minute it is read again, so a brief refusal does not last.
    vi.setSystemTime(new Date(Date.now() + 61_000));
    await fetchStateMetadata(failing.service, 'token', 'org-s', 'alex@example.test');
    expect(failing.stub.urls().length).toBeGreaterThan(afterPartial);
  });

  it('keeps a complete picture past the incomplete window', async () => {
    const { service, stub } = stubDevOps({ projects: ['Internal'] });

    const meta = await fetchStateMetadata(service, 'token', 'org-t', 'alex@example.test');
    expect(meta.discoveryComplete).toBe(true);
    const afterFirst = stub.urls().length;

    vi.setSystemTime(new Date(Date.now() + 5 * 60_000));
    await fetchStateMetadata(service, 'token', 'org-t', 'alex@example.test');

    // Five minutes on, a complete picture is still good: it is held an hour.
    expect(stub.urls().length).toBe(afterFirst);
  });

  /**
   * An organisation that cannot be read at all returns empty and incomplete.
   * That answer has to be cached too, briefly: not caching it meant the next
   * request repeated the entire fan-out, so the harder the organisation was
   * struggling the more often it was asked.
   */
  it('holds an unreadable organisation briefly instead of retrying every request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 503 }))
    );
    let reads = 0;
    const unreadable = {
      getProjects: async () => {
        reads++;
        throw new Error('no projects');
      },
    } as unknown as AzureDevOpsService;

    const first = await fetchStateMetadata(unreadable, 'token', 'org-down', 'alex@example.test');
    expect(first.categories).toEqual({});
    expect(first.discoveryComplete).toBe(false);
    expect(reads).toBe(1);

    // Inside the minute the failure is remembered rather than re-attempted.
    await fetchStateMetadata(unreadable, 'token', 'org-down', 'alex@example.test');
    expect(reads).toBe(1);

    // And past it, tried again, so an outage does not become permanent.
    vi.setSystemTime(new Date(Date.now() + 61_000));
    await fetchStateMetadata(unreadable, 'token', 'org-down', 'alex@example.test');
    expect(reads).toBe(2);
  });

  // Concurrent first requests must not each pay for the whole fan-out.
  it('collapses concurrent callers onto one read', async () => {
    const { service, stub } = stubDevOps({ projects: ['Internal'] });

    await Promise.all([
      fetchStateMetadata(service, 'token', 'org-p', 'viewer@example.test'),
      fetchStateMetadata(service, 'token', 'org-p', 'viewer@example.test'),
      fetchStateMetadata(service, 'token', 'org-p', 'viewer@example.test'),
    ]);

    expect(stub.typeRequests()).toHaveLength(1);
  });
});
