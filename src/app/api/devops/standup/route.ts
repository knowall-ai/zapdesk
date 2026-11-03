import { NextRequest, NextResponse } from 'next/server';
import { getServerSessionWithToken } from '@/lib/server-session';
import { validateOrganizationAccess } from '@/lib/devops-auth';
import { AzureDevOpsService } from '@/lib/devops';
import { normalizeStateName } from '@/lib/kanban-columns';
import { fetchStateMetadata } from '@/lib/state-discovery';
import { getGitHubTickets } from '@/lib/github-issues';
import { gitHubAvailable, gitHubSourceFor, type GitHubSource } from '@/lib/github-source';
import { gitHubPeopleFor } from '@/lib/github-people';
import { addGitHubTicketsToStandup, boardGitHubTickets } from '@/lib/github-kanban';
import type {
  StandupData,
  StandupWorkItem,
  StandupColumn,
  DevOpsWorkItem,
  TicketPriority,
} from '@/types';

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
    const session = await getServerSessionWithToken();
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
    // Work nobody owns is off the board unless asked for (#581, #530). Opt-in
    // rather than opt-out, so a caller that says nothing gets the fast board.
    const includeUnassigned = searchParams.get('includeUnassigned') === 'true';
    // Which sources the header toggle asked for (#447). Anything else is "both".
    const sources = searchParams.get('sources');
    const includeDevOps = sources !== 'github';
    const includeGitHub = sources !== 'devops';
    const targetDate = dateParam ? new Date(dateParam + 'T12:00:00Z') : new Date();

    // Step 1: Fetch state categories dynamically from DevOps (cached + deduped)
    const devopsService = new AzureDevOpsService(session.accessToken, organization);
    const {
      categories: stateCategories,
      statesByProjectType,
      categoriesByProjectType,
      discoveryComplete,
    } = await fetchStateMetadata(devopsService, session.accessToken, organization);

    if (Object.keys(stateCategories).length === 0) {
      return NextResponse.json({ error: 'Failed to fetch state categories' }, { status: 500 });
    }

    // Step 2: Fetch work items using dynamic state lists
    const { items } = includeDevOps
      ? await devopsService.getStandupData(
          targetDate,
          stateCategories,
          categoriesByProjectType,
          discoveryComplete,
          includeUnassigned
        )
      : { items: [] as DevOpsWorkItem[] };

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

    // Match column names tolerantly. The state is spelled "Todo" in the KnowAll
    // process while the column is labelled "To Do", and a byte-exact comparison
    // sent every one of those items to the category fallback — i.e. into "New",
    // leaving the "To Do" column permanently empty (#395).
    const displayColumnByNormalized = new Map(
      displayColumns.map((c) => [normalizeStateName(c.name), c.name])
    );

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
      const matched = displayColumnByNormalized.get(normalizeStateName(state));
      if (matched) return matched;
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
    const devOpsProjects = Array.from(projectMap.entries())
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

    // Step 5: Add GitHub issues as read-only cards, each on the board of the
    // project its repository is mapped to (#447). They have no iteration, so
    // the sprint filter leaves them in, as it does a DevOps item whose sprint
    // cannot be determined. GitHub being unreachable must not take the DevOps
    // board down with it.
    let projects = devOpsProjects;
    let failedGitHubRepos: string[] = [];
    if (includeGitHub && gitHubAvailable()) {
      let gitHubConfig: GitHubSource | null = null;
      try {
        const visibleProjects = await devopsService.getProjects();
        gitHubConfig = await gitHubSourceFor(organization, visibleProjects, session.accessToken);
        if (!gitHubConfig) throw new Error('GitHub is not configured');
        // Mapped and linked GitHub accounts take their DevOps name, so grouping
        // by person puts a person's issues with their DevOps work.
        const { devOpsUsers, linkedAccounts } = await gitHubPeopleFor(
          organization,
          gitHubConfig,
          () => devopsService.getOrganizationUsers(),
          session.tenantId
        );
        const gitHub = await getGitHubTickets(
          visibleProjects,
          organization,
          gitHubConfig,
          devOpsUsers,
          linkedAccounts
        );
        // The same rule as the DevOps side: an unowned issue is left off the
        // board unless asked for, so the two sources agree.
        const boardTickets = boardGitHubTickets(gitHub.tickets, includeUnassigned);
        projects = addGitHubTicketsToStandup(devOpsProjects, displayColumns, boardTickets);
        failedGitHubRepos = [...gitHubConfig.failed, ...gitHub.failedRepos];
      } catch (error) {
        console.error('Error adding GitHub issues to the standup board:', error);
        failedGitHubRepos = gitHubConfig
          ? Object.values(gitHubConfig.projectRepos).flat()
          : ['GitHub'];
      }
    }

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
      // Lets the board disable drop targets a card's type can't enter, instead
      // of letting DevOps reject the PATCH and snapping the card back (#391).
      allowedStatesByProjectType: statesByProjectType,
      ...(failedGitHubRepos.length > 0 ? { failedGitHubRepos } : {}),
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
