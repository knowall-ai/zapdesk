import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { validateOrganizationAccess } from '@/lib/devops-auth';
import { AzureDevOpsService } from '@/lib/devops';
import type {
  StandupData,
  StandupWorkItem,
  StandupColumn,
  DevOpsWorkItem,
  TicketPriority,
} from '@/types';

// Per-org TTL cache + in-flight dedup for state categories.
// State definitions virtually never change in production, so we cache
// aggressively (1 hour). The dedup map prevents thundering-herd refetches
// when many requests arrive simultaneously after a cache expiry.
const stateCategoryCacheByOrg: Map<
  string,
  { categories: Record<string, string>; timestamp: number }
> = new Map();
const stateCategoryInFlight: Map<string, Promise<Record<string, string>>> = new Map();
const STATE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Fetch work item states and build state-to-category mapping
async function fetchStateCategories(
  devopsService: AzureDevOpsService,
  accessToken: string,
  organization: string
): Promise<Record<string, string>> {
  const cached = stateCategoryCacheByOrg.get(organization);
  if (cached) {
    if (Date.now() - cached.timestamp < STATE_CACHE_TTL_MS) {
      return cached.categories;
    }
    // Expired — evict so the map doesn't accumulate stale per-org entries forever.
    stateCategoryCacheByOrg.delete(organization);
  }

  const inFlight = stateCategoryInFlight.get(organization);
  if (inFlight) return inFlight;

  const promise = doFetchStateCategories(devopsService, accessToken, organization);
  stateCategoryInFlight.set(organization, promise);
  try {
    const categories = await promise;
    if (Object.keys(categories).length > 0) {
      stateCategoryCacheByOrg.set(organization, { categories, timestamp: Date.now() });
    }
    return categories;
  } finally {
    stateCategoryInFlight.delete(organization);
  }
}

async function doFetchStateCategories(
  devopsService: AzureDevOpsService,
  accessToken: string,
  organization: string
): Promise<Record<string, string>> {
  // Reuse the cached project list rather than re-fetching independently
  let projects: { name: string }[] = [];
  try {
    projects = await devopsService.getProjects();
  } catch {
    return {};
  }
  if (projects.length === 0) return {};

  const stateCategories: Record<string, string> = {};

  // Fetch states from ALL projects to cover different process templates
  const projectResults = await Promise.allSettled(
    projects.map(async (project) => {
      // Discover work item types for this project
      const typesResponse = await fetch(
        `https://dev.azure.com/${organization}/${encodeURIComponent(project.name)}/_apis/wit/workitemtypes?api-version=7.0`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!typesResponse.ok) return [];

      const typesData = await typesResponse.json();
      const types: { name: string }[] = typesData.value || [];

      // Fetch states for each work item type in parallel
      const stateResults = await Promise.allSettled(
        types.map(async (witType) => {
          const statesResponse = await fetch(
            `https://dev.azure.com/${organization}/${encodeURIComponent(project.name)}/_apis/wit/workitemtypes/${encodeURIComponent(witType.name)}/states?api-version=7.0`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            }
          );

          if (!statesResponse.ok) return [];
          const statesData = await statesResponse.json();
          return (statesData.value || []) as { name: string; category: string }[];
        })
      );

      return stateResults
        .filter(
          (r): r is PromiseFulfilledResult<{ name: string; category: string }[]> =>
            r.status === 'fulfilled'
        )
        .flatMap((r) => r.value);
    })
  );

  for (const result of projectResults) {
    if (result.status === 'fulfilled') {
      for (const state of result.value) {
        stateCategories[state.name] = state.category;
      }
    }
  }

  return stateCategories;
}

function mapPriority(priority?: number): TicketPriority | undefined {
  if (!priority) return undefined;
  if (priority === 1) return 'Urgent';
  if (priority === 2) return 'High';
  if (priority === 3) return 'Normal';
  return 'Low';
}

function mapWorkItemToStandupItem(
  wi: DevOpsWorkItem,
  organization: string,
  stateCategories: Record<string, string>
): StandupWorkItem {
  const fields = wi.fields;
  const assignedTo = fields['System.AssignedTo'];
  const remainingWork = fields['Microsoft.VSTS.Scheduling.RemainingWork'] as number | undefined;
  return {
    id: wi.id,
    title: fields['System.Title'],
    state: fields['System.State'],
    stateCategory: stateCategories[fields['System.State']] || 'Proposed',
    workItemType: fields['System.WorkItemType'],
    assignee: assignedTo
      ? {
          id: assignedTo.id,
          displayName: assignedTo.displayName,
          email: assignedTo.uniqueName,
          avatarUrl: assignedTo.imageUrl,
        }
      : undefined,
    priority: mapPriority(fields['Microsoft.VSTS.Common.Priority']),
    updatedAt: fields['System.ChangedDate'],
    createdAt: fields['System.CreatedDate'],
    project: fields['System.TeamProject'],
    devOpsUrl: `https://dev.azure.com/${organization}/${encodeURIComponent(fields['System.TeamProject'])}/_workitems/edit/${wi.id}`,
    tags:
      fields['System.Tags']
        ?.split(';')
        .map((t: string) => t.trim())
        .filter(Boolean) || [],
    iterationPath: (fields['System.IterationPath'] as string) || undefined,
    remainingWork: typeof remainingWork === 'number' ? remainingWork : undefined,
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const organization = request.headers.get('x-devops-org');
    if (!organization) {
      return NextResponse.json({ error: 'No organization specified' }, { status: 400 });
    }

    const hasAccess = await validateOrganizationAccess(session.accessToken, organization);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const currentSprintOnly = searchParams.get('currentSprintOnly') === 'true';
    const targetDate = dateParam ? new Date(dateParam + 'T12:00:00Z') : new Date();

    // Step 1: Fetch state categories dynamically from DevOps (cached + deduped)
    const devopsService = new AzureDevOpsService(session.accessToken, organization);
    const stateCategories = await fetchStateCategories(
      devopsService,
      session.accessToken,
      organization
    );

    if (Object.keys(stateCategories).length === 0) {
      return NextResponse.json({ error: 'Failed to fetch state categories' }, { status: 500 });
    }

    // Step 2: Fetch work items using dynamic state lists
    const { items } = await devopsService.getStandupData(targetDate, stateCategories);

    // Step 2b: If currentSprintOnly, fetch current iterations and filter
    let currentIterations: Map<string, string> | null = null;
    if (currentSprintOnly) {
      currentIterations = await devopsService.getCurrentIterations();
    }

    function isInCurrentSprint(wi: DevOpsWorkItem): boolean {
      if (!currentIterations) return true;
      const project = wi.fields['System.TeamProject'];
      const iterationPath = wi.fields['System.IterationPath'] as string | undefined;
      const currentIteration = currentIterations.get(project);
      // If we can't determine the iteration, don't filter the item out
      if (!currentIteration || !iterationPath) return true;
      return iterationPath.startsWith(currentIteration);
    }

    const filteredItems = items.filter(isInCurrentSprint);

    // Step 3: Define the 6 display columns and map DevOps states to them
    // Items in states not matching a column are bucketed by their category.
    const displayColumns: { name: string; category: string }[] = [
      { name: 'New', category: 'Proposed' },
      { name: 'To Do', category: 'Proposed' },
      { name: 'Active', category: 'InProgress' },
      { name: 'Blocked', category: 'InProgress' },
      { name: 'Resolved', category: 'Resolved' },
      { name: 'Closed', category: 'Completed' },
    ];

    const displayColumnNames = new Set(displayColumns.map((c) => c.name));

    // Map non-display states to the fallback column for their category.
    // 'Removed' is omitted because getStandupData filters those out before
    // we get here (issue #277).
    const categoryFallback: Record<string, string> = {
      Proposed: 'New',
      InProgress: 'Active',
      Resolved: 'Resolved',
      Completed: 'Closed',
    };

    // Resolve any DevOps state to one of the 6 display columns
    function resolveColumn(state: string): string {
      if (displayColumnNames.has(state)) return state;
      const category = stateCategories[state] || 'Proposed';
      return categoryFallback[category] || 'New';
    }

    // Step 4: Group work items by project and display column
    const projectMap = new Map<string, Map<string, StandupWorkItem[]>>();

    const ensureProject = (name: string): Map<string, StandupWorkItem[]> => {
      if (!projectMap.has(name)) {
        const colMap = new Map<string, StandupWorkItem[]>();
        for (const col of displayColumns) {
          colMap.set(col.name, []);
        }
        projectMap.set(name, colMap);
      }
      return projectMap.get(name)!;
    };

    // Place items into their resolved column
    for (const wi of filteredItems) {
      const colMap = ensureProject(wi.fields['System.TeamProject']);
      const column = resolveColumn(wi.fields['System.State']);
      colMap.get(column)!.push(mapWorkItemToStandupItem(wi, organization, stateCategories));
    }

    // Build project data sorted alphabetically
    const projects = Array.from(projectMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([projectName, colMap]) => ({
        projectName,
        columns: displayColumns.map(
          (col): StandupColumn => ({
            name: col.name,
            category: col.category,
            items: colMap.get(col.name) || [],
          })
        ),
      }));

    // Build summary counts per column
    const columnCounts: Record<string, number> = {};
    for (const col of displayColumns) {
      columnCounts[col.name] = projects.reduce(
        (sum, p) => sum + (p.columns.find((c) => c.name === col.name)?.items.length || 0),
        0
      );
    }

    const response: StandupData = {
      date: targetDate.toISOString().split('T')[0],
      projects,
      columns: displayColumns,
      summary: {
        columnCounts,
        projectCount: projects.length,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching standup data:', error);
    return NextResponse.json({ error: 'Failed to fetch standup data' }, { status: 500 });
  }
}
