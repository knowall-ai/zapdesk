import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService, workItemToTicket, setStateCategoryCache } from '@/lib/devops';
import type { Ticket, TicketStatus } from '@/types';

// Fetch work item states and build state-to-category mapping
async function fetchAndCacheStateCategories(accessToken: string, organization: string) {
  try {
    // Get first project
    const projectsResponse = await fetch(
      `https://dev.azure.com/${organization}/_apis/projects?api-version=7.0`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!projectsResponse.ok) return;

    const projectsData = await projectsResponse.json();
    const firstProject = projectsData.value?.[0]?.name;
    if (!firstProject) return;

    const stateCategories: Record<string, string> = {};
    const workItemTypes = ['Bug', 'Task', 'Enhancement', 'Issue'];

    for (const witType of workItemTypes) {
      try {
        const statesResponse = await fetch(
          `https://dev.azure.com/${organization}/${encodeURIComponent(firstProject)}/_apis/wit/workitemtypes/${encodeURIComponent(witType)}/states?api-version=7.0`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (statesResponse.ok) {
          const statesData = await statesResponse.json();
          for (const state of statesData.value || []) {
            stateCategories[state.name] = state.category;
          }
        }
      } catch {
        // Continue if one work item type fails
      }
    }

    setStateCategoryCache(stateCategories);
  } catch (error) {
    console.error('Failed to fetch state categories:', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { project, title, description, priority, assignee, tags } = body;

    if (!project || !title) {
      return NextResponse.json({ error: 'Project and title are required' }, { status: 400 });
    }

    // Get organization from header or use default
    const organization = request.headers.get('x-devops-org') || undefined;
    const devopsService = new AzureDevOpsService(session.accessToken, organization);

    // Create the ticket with 'ticket' tag always included
    const allTags = ['ticket', ...(tags || [])].filter(Boolean);
    const workItem = await devopsService.createTicketWithAssignee(
      project,
      title,
      description || '',
      session.user?.email || 'unknown',
      priority || 3,
      allTags,
      assignee
    );

    const ticket = workItemToTicket(workItem);

    return NextResponse.json({ ticket, success: true });
  } catch (error) {
    console.error('Error creating ticket:', error);
    return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const view = searchParams.get('view') || 'all-unsolved';
    // ticketsOnly defaults to true - only show work items tagged with "ticket"
    const ticketsOnly = searchParams.get('ticketsOnly') !== 'false';

    // Get organization from header (client sends from localStorage selection)
    const organization = request.headers.get('x-devops-org');

    if (!organization) {
      return NextResponse.json({ error: 'No organization specified' }, { status: 400 });
    }

    // Fetch and cache state categories before getting tickets
    await fetchAndCacheStateCategories(session.accessToken, organization);

    const devopsService = new AzureDevOpsService(session.accessToken, organization);
    const tickets = await devopsService.getAllTickets(ticketsOnly);

    // Filter tickets based on view
    const filteredTickets = filterTicketsByView(tickets, view, session.user?.email);

    return NextResponse.json({
      tickets: filteredTickets,
      total: filteredTickets.length,
    });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    return NextResponse.json({ error: 'Failed to fetch tickets' }, { status: 500 });
  }
}

function filterTicketsByView(tickets: Ticket[], view: string, userEmail?: string | null): Ticket[] {
  const activeStatuses: TicketStatus[] = ['New', 'Open', 'In Progress', 'Pending'];

  switch (view) {
    case 'your-active':
    case 'your-unsolved':
      return tickets.filter(
        (t) => activeStatuses.includes(t.status) && t.assignee?.email === userEmail
      );

    case 'unassigned':
      return tickets.filter((t) => !t.assignee && activeStatuses.includes(t.status));

    case 'all-active':
    case 'all-unsolved':
      return tickets.filter((t) => activeStatuses.includes(t.status));

    case 'recently-updated':
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return tickets.filter((t) => t.updatedAt >= weekAgo);

    case 'created-today':
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return tickets.filter((t) => t.createdAt >= today);

    case 'pending':
      return tickets.filter((t) => t.status === 'Pending');

    case 'recently-solved':
      const weekAgoSolved = new Date();
      weekAgoSolved.setDate(weekAgoSolved.getDate() - 7);
      return tickets.filter(
        (t) => (t.status === 'Resolved' || t.status === 'Closed') && t.updatedAt >= weekAgoSolved
      );

    default:
      return tickets;
  }
}
