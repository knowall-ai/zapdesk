import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService, workItemToTicket } from '@/lib/devops';
import type { Ticket, TicketStatus } from '@/types';

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

    // Get organization from header or use default
    const organization = request.headers.get('x-devops-org') || undefined;
    const devopsService = new AzureDevOpsService(session.accessToken, organization);
    const tickets = await devopsService.getAllTickets();

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
  const unsolvedStatuses: TicketStatus[] = ['New', 'Open', 'In Progress', 'Pending'];

  switch (view) {
    case 'your-unsolved':
      return tickets.filter(
        (t) => unsolvedStatuses.includes(t.status) && t.assignee?.email === userEmail
      );

    case 'unassigned':
      return tickets.filter((t) => !t.assignee && unsolvedStatuses.includes(t.status));

    case 'all-unsolved':
      return tickets.filter((t) => unsolvedStatuses.includes(t.status));

    case 'recently-updated':
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return tickets.filter((t) => t.updatedAt >= weekAgo);

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
