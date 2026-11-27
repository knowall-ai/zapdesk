import { NextRequest, NextResponse } from 'next/server';
import { getServerSessionWithToken } from '@/lib/server-session';
import { requestDevOpsOrg } from '@/lib/devops-org';

/** The most work item types `types` may name. */
const MAX_TYPES = 20;

/**
 * How long one type's lookup may take, reading its answer included. Under the
 * board's 10-second wait, so the types that did answer still reach it when
 * one hangs (#687 review). A type that runs out of time is skipped.
 */
const STATE_LOOKUP_TIMEOUT_MS = 7_000;

/** The query parameters this route understands; any other is refused. */
const QUERY_KEYS = new Set(['type', 'types', 'project']);

interface WorkItemState {
  name: string;
  color: string;
  category: string;
}

interface WorkItemTypeStates {
  workItemType: string;
  states: WorkItemState[];
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSessionWithToken();

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const organization = requestDevOpsOrg(request);
    if (!organization) {
      return NextResponse.json({ error: 'No Azure DevOps organization selected' }, { status: 400 });
    }

    // Optional query params to filter by specific work item type and project
    const { searchParams } = new URL(request.url);
    // A misspelt key (`tyeps`) would otherwise be ignored and answered with
    // the default types, which looks like success (#687 review).
    const unknownKeys = [...new Set(searchParams.keys())].filter((key) => !QUERY_KEYS.has(key));
    if (unknownKeys.length > 0) {
      return NextResponse.json(
        { error: `Unknown query parameter: ${unknownKeys.join(', ')}` },
        { status: 400 }
      );
    }
    const typeFilter = searchParams.get('type');
    const projectFilter = searchParams.get('project');

    // `types` (comma-separated) names the types the caller has cards of, so a
    // board can learn each one's states in each project (Scrum's Product
    // Backlog Item, say), not only the four defaults.
    const typesParam = (searchParams.get('types') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    // Refused rather than cut short: a shortened list answered 200 would look
    // complete to the caller (#687 review). Checked before any DevOps call,
    // project discovery included. Callers send at most this many.
    if (typesParam.length > MAX_TYPES) {
      return NextResponse.json(
        { error: `At most ${MAX_TYPES} work item types per request` },
        { status: 400 }
      );
    }

    // Determine which project to query
    let projectName = projectFilter;
    if (!projectName) {
      // Fallback: get first project
      const projectsResponse = await fetch(
        `https://dev.azure.com/${organization}/_apis/projects?api-version=7.0`,
        {
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!projectsResponse.ok) {
        return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
      }

      const projectsData = await projectsResponse.json();
      projectName = projectsData.value?.[0]?.name;

      if (!projectName) {
        return NextResponse.json({ error: 'No projects found' }, { status: 404 });
      }
    }

    // If a specific type is requested, fetch states for just that type
    const workItemTypes = typeFilter
      ? [typeFilter]
      : typesParam.length > 0
        ? typesParam
        : ['Bug', 'Task', 'Enhancement', 'Issue'];
    const allStates: WorkItemTypeStates[] = [];
    const uniqueStates = new Map<string, WorkItemState>();

    // Fetch states for each work item type, all at once: one after another,
    // a batch of many types could outlast the board's 10-second wait
    // (#687 review). Results are taken in the requested order, and a type that
    // fails is skipped without taking the others with it.
    const project = projectName;
    // The upstream status of each type that could not be read (0: no answer).
    const failures = new Map<string, number>();
    const fetched = await Promise.all(
      workItemTypes.map(async (witType): Promise<WorkItemTypeStates | null> => {
        try {
          const statesResponse = await fetch(
            `https://dev.azure.com/${organization}/${encodeURIComponent(project)}/_apis/wit/workitemtypes/${encodeURIComponent(witType)}/states?api-version=7.0`,
            {
              headers: {
                Authorization: `Bearer ${session.accessToken}`,
                'Content-Type': 'application/json',
              },
              // Covers reading the body too: it is read under the same signal.
              signal: AbortSignal.timeout(STATE_LOOKUP_TIMEOUT_MS),
            }
          );
          if (!statesResponse.ok) {
            failures.set(witType, statesResponse.status);
            return null;
          }
          const statesData = await statesResponse.json();
          const states: WorkItemState[] = (statesData.value || []).map(
            (s: { name: string; color: string; category: string }) => ({
              name: s.name,
              color: s.color,
              category: s.category,
            })
          );
          return { workItemType: witType, states };
        } catch (error) {
          console.error(`Error fetching states for ${witType}:`, error);
          failures.set(witType, 0);
          return null;
        }
      })
    );

    // One named type is the whole answer. An empty 200 would read as "this
    // type has no states", and a menu offered nothing -- or a made-up Active
    // -- with no word of the failure (#725). Skipping a failed type stays
    // right for the lists, where the other types still answer.
    if (typeFilter && !fetched[0]) {
      const upstream = failures.get(typeFilter);
      return NextResponse.json(
        { error: `Could not read the states of the "${typeFilter}" work item type` },
        { status: upstream === 404 ? 404 : 502 }
      );
    }

    for (const entry of fetched) {
      if (!entry) continue;
      allStates.push(entry);
      // Collect unique states
      for (const state of entry.states) {
        if (!uniqueStates.has(state.name)) {
          uniqueStates.set(state.name, state);
        }
      }
    }

    // Sort states by category order: Proposed -> InProgress -> Resolved -> Completed -> Removed
    const categoryOrder: Record<string, number> = {
      Proposed: 1,
      InProgress: 2,
      Resolved: 3,
      Completed: 4,
      Removed: 5,
    };

    const sortedStates = Array.from(uniqueStates.values()).sort((a, b) => {
      const orderA = categoryOrder[a.category] || 99;
      const orderB = categoryOrder[b.category] || 99;
      return orderA - orderB;
    });

    return NextResponse.json({
      statesByType: allStates,
      allStates: sortedStates,
    });
  } catch (error) {
    console.error('Error fetching work item states:', error);
    return NextResponse.json({ error: 'Failed to fetch work item states' }, { status: 500 });
  }
}
