import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';
import type { SearchResult, SearchResponse, Ticket, Customer, Organization } from '@/types';

const MAX_RESULTS_PER_TYPE = 5;

function searchTickets(tickets: Ticket[], query: string): SearchResult[] {
  const lowerQuery = query.toLowerCase();
  const queryAsNumber = parseInt(query, 10);

  return tickets
    .filter((ticket) => {
      // Match by ID (exact or partial)
      if (!isNaN(queryAsNumber) && ticket.id.toString().includes(query)) {
        return true;
      }
      // Match by title
      if (ticket.title.toLowerCase().includes(lowerQuery)) {
        return true;
      }
      // Match by description
      if (ticket.description?.toLowerCase().includes(lowerQuery)) {
        return true;
      }
      // Match by requester name or email
      if (
        ticket.requester.displayName.toLowerCase().includes(lowerQuery) ||
        ticket.requester.email.toLowerCase().includes(lowerQuery)
      ) {
        return true;
      }
      return false;
    })
    .slice(0, MAX_RESULTS_PER_TYPE)
    .map((ticket) => ({
      id: ticket.id.toString(),
      type: 'ticket' as const,
      title: `#${ticket.id} ${ticket.title}`,
      subtitle: `${ticket.requester.displayName} • ${ticket.status}`,
      url: `/tickets/${ticket.id}`,
      priority: ticket.priority,
      status: ticket.status,
    }));
}

function searchCustomers(customers: Customer[], query: string): SearchResult[] {
  const lowerQuery = query.toLowerCase();

  return customers
    .filter((customer) => {
      if (customer.displayName.toLowerCase().includes(lowerQuery)) {
        return true;
      }
      if (customer.email.toLowerCase().includes(lowerQuery)) {
        return true;
      }
      return false;
    })
    .slice(0, MAX_RESULTS_PER_TYPE)
    .map((customer) => ({
      id: customer.id,
      type: 'customer' as const,
      title: customer.displayName,
      subtitle: customer.email,
      url: `/customers?search=${encodeURIComponent(customer.email)}`,
      avatarUrl: customer.avatarUrl,
    }));
}

function searchOrganizations(organizations: Organization[], query: string): SearchResult[] {
  const lowerQuery = query.toLowerCase();

  return organizations
    .filter((org) => {
      if (org.name.toLowerCase().includes(lowerQuery)) {
        return true;
      }
      if (org.domain?.toLowerCase().includes(lowerQuery)) {
        return true;
      }
      return false;
    })
    .slice(0, MAX_RESULTS_PER_TYPE)
    .map((org) => ({
      id: org.id,
      type: 'organization' as const,
      title: org.name,
      subtitle: org.domain || org.devOpsProject,
      url: `/organizations?search=${encodeURIComponent(org.name)}`,
    }));
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q')?.trim();

    if (!query || query.length < 2) {
      return NextResponse.json<SearchResponse>({ results: [], query: query || '' });
    }

    const devopsService = new AzureDevOpsService(session.accessToken);

    // Fetch data in parallel
    const [tickets, projects] = await Promise.all([
      devopsService.getAllTickets(),
      devopsService.getProjects(),
    ]);

    // Extract customers from tickets
    const customerMap = new Map<string, Customer>();
    for (const ticket of tickets) {
      if (!customerMap.has(ticket.requester.email)) {
        customerMap.set(ticket.requester.email, {
          id: ticket.requester.id,
          displayName: ticket.requester.displayName,
          email: ticket.requester.email,
          organizationId: ticket.organization?.id,
          organization: ticket.organization,
          timezone: 'Europe/Dublin',
          tags: [],
          avatarUrl: ticket.requester.avatarUrl,
          lastUpdated: ticket.updatedAt,
        });
      }
    }
    const customers = Array.from(customerMap.values());

    // Map projects to organizations
    const organizations: Organization[] = projects.map((project) => ({
      id: project.id,
      name: project.name,
      devOpsProject: project.name,
      devOpsOrg: 'KnowAll',
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    // Search across all data types
    const ticketResults = searchTickets(tickets, query);
    const customerResults = searchCustomers(customers, query);
    const organizationResults = searchOrganizations(organizations, query);

    // Combine results, prioritizing tickets
    const results: SearchResult[] = [...ticketResults, ...organizationResults, ...customerResults];

    return NextResponse.json<SearchResponse>({ results, query });
  } catch (error) {
    console.error('Error searching:', error);
    return NextResponse.json({ error: 'Failed to search' }, { status: 500 });
  }
}
