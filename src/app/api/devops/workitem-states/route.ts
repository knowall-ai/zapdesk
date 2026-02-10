import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

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
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const organization = process.env.AZURE_DEVOPS_ORG || 'KnowAll';

    // Optional query params to filter by specific work item type and project
    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get('type');
    const projectFilter = searchParams.get('project');

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
    const workItemTypes = typeFilter ? [typeFilter] : ['Bug', 'Task', 'Enhancement', 'Issue'];
    const allStates: WorkItemTypeStates[] = [];
    const uniqueStates = new Map<string, WorkItemState>();

    // Fetch states for each work item type
    for (const witType of workItemTypes) {
      try {
        const statesResponse = await fetch(
          `https://dev.azure.com/${organization}/${encodeURIComponent(projectName)}/_apis/wit/workitemtypes/${encodeURIComponent(witType)}/states?api-version=7.0`,
          {
            headers: {
              Authorization: `Bearer ${session.accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (statesResponse.ok) {
          const statesData = await statesResponse.json();
          const states: WorkItemState[] = (statesData.value || []).map(
            (s: { name: string; color: string; category: string }) => ({
              name: s.name,
              color: s.color,
              category: s.category,
            })
          );

          allStates.push({
            workItemType: witType,
            states,
          });

          // Collect unique states (excluding Removed)
          for (const state of states) {
            if (state.name !== 'Removed' && !uniqueStates.has(state.name)) {
              uniqueStates.set(state.name, state);
            }
          }
        }
      } catch (error) {
        console.error(`Error fetching states for ${witType}:`, error);
      }
    }

    // Sort states by category order: Proposed -> InProgress -> Resolved -> Completed
    const categoryOrder: Record<string, number> = {
      Proposed: 1,
      InProgress: 2,
      Resolved: 3,
      Completed: 4,
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
