/**
 * What states the board may show, discovered from Azure DevOps.
 *
 * Its own module rather than part of the route, so the fan-out can be tested
 * against a mocked network boundary instead of by reading the source for the
 * shape of it (#604, #4337 review). The route is an HTTP handler; this is the
 * logic worth testing.
 */
import { AzureDevOpsService } from './devops';
import { isBoardWorkItemType } from './board-work-item-types';
import { DEVOPS_CONCURRENCY, discardBody, fetchWithRetry, mapWithLimit } from './throttled-fetch';

/** State definitions for an org, in both the shapes the board needs. */
export interface StateMetadata {
  /** State name -> category, unioned across every project and work item type. */
  categories: Record<string, string>;
  /**
   * Project -> work item type -> the state names that type actually defines
   * there. The union in `categories` can't answer "may this card enter that
   * column?", because states are defined per work item type *and* per
   * project's process template: an Agile-template Bug has no "To Do" state
   * even when a Task in the same project does, and a Bug in a different
   * project may have one (#391).
   */
  statesByProjectType: Record<string, Record<string, string[]>>;
  /**
   * Project -> work item type -> state name -> that state's category *for that
   * type*.
   *
   * `categories` above flattens this by state name, which is lossy: two work
   * item types can use the same state name in different categories, and the
   * last one written wins. That flat map is fine for column ordering, but not
   * for deciding whether a given item is Removed — see `getStandupData` (#277).
   */
  categoriesByProjectType: Record<string, Record<string, Record<string, string>>>;
  /**
   * False when any project's type list or any type's state list failed to
   * load, so `categoriesByProjectType` describes only part of the org.
   *
   * It matters because the two halves of the Removed filter fail in opposite
   * directions. Dropping a state name from the WIQL query is unrecoverable —
   * items never fetched can't be filtered back in — so a partial picture must
   * not be treated as agreement that a name is Removed everywhere (#277).
   */
  discoveryComplete: boolean;
}

// TTL cache + in-flight dedup for state metadata. State definitions virtually
// never change in production, so a complete picture is held for an hour. The
// dedup map prevents a thundering herd of refetches when many requests arrive
// at once after an entry expires.
const stateCategoryCache: Map<string, StateMetadata & { timestamp: number }> = new Map();
const stateCategoryInFlight: Map<string, Promise<StateMetadata>> = new Map();
const STATE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * How long an *incomplete* picture is held.
 *
 * Far shorter than an hour, and that matters more than it looks. Discovery
 * fails safe when it is incomplete: `partitionStandupStates` treats nothing as
 * agreed, which hides resolved items older than ninety days, and cards in an
 * undescribed project are refused by every drop target. Holding that for an
 * hour would mean one bad minute costs an hour of a wrong board -- and would
 * undo the retry this module gained, which exists precisely so a brief refusal
 * does not become a lasting one.
 *
 * Still cached rather than not cached at all: an organisation answering 503 is
 * the last one that should be asked again by every request that arrives.
 */
const INCOMPLETE_STATE_CACHE_TTL_MS = 60 * 1000; // 1 minute

/**
 * The cache key: the organisation *and* who is asking.
 *
 * `doFetchStateMetadata` builds its picture from `getProjects()`, which is
 * scoped to the caller's token -- so the picture is the caller's, not the
 * organisation's. Keyed by organisation alone, the first user through
 * populates it for everyone, and a user who can see fewer projects is handed
 * `allowedStatesByProjectType` naming projects they have no access to. In this
 * product a project is a customer, so those names are the thing least safe to
 * hand to the wrong person.
 *
 * The viewer's own identity, not their access token: a token is rotated and
 * would miss the cache on every refresh, while the identity is what the
 * visibility actually follows.
 */
function cacheKeyFor(organization: string, viewer: string): string {
  return `${organization.toLowerCase()}|${viewer.toLowerCase()}`;
}

// Fetch work item states, keyed both by state name and by work item type
export async function fetchStateMetadata(
  devopsService: AzureDevOpsService,
  accessToken: string,
  organization: string,
  /**
   * Who is asking, as a stable identifier. Part of the cache key, because
   * which projects they can see is part of the answer.
   */
  viewer: string
): Promise<StateMetadata> {
  const key = cacheKeyFor(organization, viewer);
  const cached = stateCategoryCache.get(key);
  if (cached) {
    const ttl = cached.discoveryComplete ? STATE_CACHE_TTL_MS : INCOMPLETE_STATE_CACHE_TTL_MS;
    if (Date.now() - cached.timestamp < ttl) {
      return {
        categories: cached.categories,
        statesByProjectType: cached.statesByProjectType,
        categoriesByProjectType: cached.categoriesByProjectType,
        discoveryComplete: cached.discoveryComplete,
      };
    }
    // Expired - evict so the map doesn't accumulate stale entries forever.
    stateCategoryCache.delete(key);
  }

  const inFlight = stateCategoryInFlight.get(key);
  if (inFlight) return inFlight;

  const promise = doFetchStateMetadata(devopsService, accessToken, organization);
  stateCategoryInFlight.set(key, promise);
  try {
    const metadata = await promise;
    if (Object.keys(metadata.categories).length > 0) {
      stateCategoryCache.set(key, { ...metadata, timestamp: Date.now() });
    }
    return metadata;
  } finally {
    stateCategoryInFlight.delete(key);
  }
}

async function doFetchStateMetadata(
  devopsService: AzureDevOpsService,
  accessToken: string,
  organization: string
): Promise<StateMetadata> {
  const empty: StateMetadata = {
    categories: {},
    statesByProjectType: {},
    categoriesByProjectType: {},
    discoveryComplete: false,
  };

  // Reuse the cached project list rather than re-fetching independently
  let projects: { name: string }[] = [];
  try {
    projects = await devopsService.getProjects();
  } catch {
    return empty;
  }
  if (projects.length === 0) return empty;

  const stateCategories: Record<string, string> = {};
  const statesByProjectType: Record<string, Record<string, Set<string>>> = {};
  const categoriesByProjectType: Record<string, Record<string, Record<string, string>>> = {};

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  const typesUrl = (project: string) =>
    `https://dev.azure.com/${organization}/${encodeURIComponent(project)}/_apis/wit/workitemtypes?api-version=7.0`;
  const statesUrl = (project: string, type: string) =>
    `https://dev.azure.com/${organization}/${encodeURIComponent(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states?api-version=7.0`;

  // Discovery runs as two paced phases rather than one unbounded fan-out
  // (#604). It used to be Promise.allSettled over every project with another
  // Promise.allSettled over every type inside it: hundreds of requests in
  // flight at once, which Azure DevOps answers with 503.
  //
  // Flattened rather than nested-but-limited, because nesting two limits
  // multiplies them -- eight projects each fetching eight types is sixty-four
  // requests, not eight. Phase two collects every project/type pair first so
  // one limit governs the whole of it, and a project with twenty types cannot
  // crowd out the rest.
  //
  // Phase one: which types each project defines.
  const typeResults = await mapWithLimit(projects, DEVOPS_CONCURRENCY, async (project) => {
    const response = await fetchWithRetry(typesUrl(project.name), { headers });
    if (!response.ok) {
      console.warn(
        `[Standup] work item types for ${project.name}: ${response.status} ${response.statusText}`
      );
      // Nobody reads this body, and an unread one holds its connection.
      await discardBody(response);
      return null;
    }
    const data = await response.json();
    return ((data.value || []) as { name: string }[]).map((witType) => witType.name);
  });

  /** Every project/type pair to ask about, and which projects we could not read. */
  const pairs: { project: string; type: string }[] = [];
  const incompleteProjects = new Set<string>();
  typeResults.forEach((result, index) => {
    const project = projects[index].name;
    if (result.status !== 'fulfilled' || result.value === null) {
      // A project whose type list never arrived is not described at all, so
      // its picture is incomplete whatever else succeeds.
      incompleteProjects.add(project);
      if (result.status === 'rejected') {
        console.warn(`[Standup] work item types for ${project} failed:`, result.reason);
      }
      return;
    }
    // Only the types the board can show (#4337).
    //
    // A project defines around twenty; the board queries six. The rest are
    // Epic, Feature, Test Case, Shared Steps, Code Review Request and the
    // like, and the WIQL filters every one of them out, so nothing could ever
    // read their states. Asking anyway cost three quarters of the requests
    // here -- 591 instead of 131 across 34 projects.
    //
    // Filtered before the pair is queued, not after the answers arrive,
    // because the cost is the round trips. The list is shared with the query
    // that decides which types reach the board, so the two cannot disagree:
    // a type the query fetches but discovery never described would have no
    // per-type state data, and every card of it would be refused by every
    // drop target.
    for (const type of result.value) {
      if (isBoardWorkItemType(type)) pairs.push({ project, type });
    }
  });

  // Phase two: the states of each of those types.
  const stateResults = await mapWithLimit(pairs, DEVOPS_CONCURRENCY, async ({ project, type }) => {
    const response = await fetchWithRetry(statesUrl(project, type), { headers });
    if (!response.ok) {
      console.warn(
        `[Standup] states for ${project}/${type}: ${response.status} ${response.statusText}`
      );
      await discardBody(response);
      return null;
    }
    const data = await response.json();
    return (data.value || []) as { name: string; category: string }[];
  });

  const projectResults = new Map<
    string,
    { type: string; states: { name: string; category: string }[] }[]
  >();
  stateResults.forEach((result, index) => {
    const { project, type } = pairs[index];
    if (result.status !== 'fulfilled' || result.value === null) {
      // One unreadable type leaves this project's picture incomplete, which is
      // what the Removed and closed-window filters fall back to safety on.
      incompleteProjects.add(project);
      if (result.status === 'rejected') {
        console.warn(`[Standup] states for ${project}/${type} failed:`, result.reason);
      }
      return;
    }
    const forProject = projectResults.get(project) ?? [];
    forProject.push({ type, states: result.value });
    projectResults.set(project, forProject);
  });

  // Complete only when every project was fully described. Partial discovery is
  // reported, not hidden: the filters downstream deliberately fail safe on it.
  const discoveryComplete = incompleteProjects.size === 0;
  if (!discoveryComplete) {
    console.warn(
      `[Standup] state discovery incomplete for ${incompleteProjects.size} of ${projects.length} projects; ` +
        `resolved items older than 90 days may be hidden until this succeeds`
    );
  }

  for (const [project, types] of projectResults) {
    for (const { type, states } of types) {
      for (const state of states) {
        // Categories stay org-wide here: they only drive column *ordering*,
        // which is a union across templates by design.
        stateCategories[state.name] = state.category;
        // Allowed states are kept per project, because a state defined only in
        // another project's process template must not unblock a column here.
        ((statesByProjectType[project] ??= {})[type] ??= new Set()).add(state.name);
        // The category is kept per project and type too. The flat map above
        // loses it when two types share a state name in different categories,
        // and "is this item Removed?" has to be answered per item (#277).
        ((categoriesByProjectType[project] ??= {})[type] ??= {})[state.name] = state.category;
      }
    }
  }

  return {
    categories: stateCategories,
    statesByProjectType: Object.fromEntries(
      Object.entries(statesByProjectType).map(([project, byType]) => [
        project,
        Object.fromEntries(
          Object.entries(byType).map(([type, states]) => [type, Array.from(states)])
        ),
      ])
    ),
    categoriesByProjectType,
    discoveryComplete,
  };
}
/** For tests: forget every organisation's discovered states. */
export function clearStateMetadataCache(): void {
  stateCategoryCache.clear();
  stateCategoryInFlight.clear();
}
