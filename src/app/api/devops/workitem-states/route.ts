import { NextResponse } from 'next/server';
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

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const organization = process.env.AZURE_DEVOPS_ORG || 'KnowAll';

    // Get all projects first
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
    const firstProject = projectsData.value?.[0]?.name;

    if (!firstProject) {
      return NextResponse.json({ error: 'No projects found' }, { status: 404 });
    }

    // Work item types we care about for tickets (includes Issue for "Active" state)
    const workItemTypes = ['Bug', 'Task', 'Enhancement', 'Issue'];
    const allStates: WorkItemTypeStates[] = [];
    const uniqueStates = new Map<string, WorkItemState>();

    // Fetch states for each work item type
    for (const witType of workItemTypes) {
      try {
        const statesResponse = await fetch(
          `https://dev.azure.com/${organization}/${encodeURIComponent(firstProject)}/_apis/wit/workitemtypes/${encodeURIComponent(witType)}/states?api-version=7.0`,
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

          // Log states for each work item type with category
          console.log('────────────────────────────────────────');
          console.log(`Work Item Type: ${witType}`);
          console.log(
            `States: ${states.length > 0 ? states.map((s) => `${s.name} (${s.category})`).join(', ') : '(empty - type may not exist)'}`
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
        } else {
          // Log when work item type doesn't exist or no states returned
          console.log('────────────────────────────────────────');
          console.log(`Work Item Type: ${witType}`);
          console.log('States: (empty - type may not exist)');
        }
      } catch (error) {
        console.log('────────────────────────────────────────');
        console.log(`Work Item Type: ${witType}`);
        console.log(`States: (error fetching: ${error})`);
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

    console.log(
      '[WorkItemStates] Final unique states:',
      sortedStates.map((s) => s.name).join(', ')
    );

    return NextResponse.json({
      statesByType: allStates,
      allStates: sortedStates,
    });
  } catch (error) {
    console.error('Error fetching work item states:', error);
    return NextResponse.json({ error: 'Failed to fetch work item states' }, { status: 500 });
  }
}
