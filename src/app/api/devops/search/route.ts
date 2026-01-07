import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';

interface SearchResult {
  type: 'ticket' | 'user' | 'organization';
  id: string;
  title: string;
  subtitle?: string;
  url: string;
  status?: string;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q')?.toLowerCase().trim();

    if (!query || query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const devopsService = new AzureDevOpsService(session.accessToken);
    const results: SearchResult[] = [];

    // Search tickets
    const tickets = await devopsService.getAllTickets();
    const matchingTickets = tickets
      .filter(
        (t) =>
          t.title.toLowerCase().includes(query) ||
          t.id.toString().includes(query) ||
          t.description?.toLowerCase().includes(query)
      )
      .slice(0, 5)
      .map((t) => ({
        type: 'ticket' as const,
        id: t.id.toString(),
        title: t.title,
        subtitle: `#${t.id} • ${t.status}`,
        url: `/tickets/${t.id}`,
        status: t.status,
      }));
    results.push(...matchingTickets);

    // Search organizations (projects)
    const projects = await devopsService.getProjects();
    const matchingOrgs = projects
      .filter((p) => p.name.toLowerCase().includes(query))
      .slice(0, 3)
      .map((p) => ({
        type: 'organization' as const,
        id: p.id,
        title: p.name,
        subtitle: 'Organization',
        url: `/organizations/${p.id}`,
      }));
    results.push(...matchingOrgs);

    // Search users (from team members) - fetch in parallel to avoid N+1 queries
    const userMap = new Map<string, SearchResult>();
    const projectMembersArrays = await Promise.all(
      projects.slice(0, 3).map(async (project) => {
        try {
          return await devopsService.getTeamMembers(project.name);
        } catch {
          return [];
        }
      })
    );

    for (const members of projectMembersArrays) {
      for (const member of members) {
        if (
          !userMap.has(member.email) &&
          (member.displayName.toLowerCase().includes(query) ||
            member.email.toLowerCase().includes(query))
        ) {
          userMap.set(member.email, {
            type: 'user' as const,
            id: member.id,
            title: member.displayName,
            subtitle: member.email,
            url: `/users`,
          });
        }
      }
    }
    results.push(...Array.from(userMap.values()).slice(0, 3));

    // Sort by type priority: tickets first, then users, then orgs
    const typePriority = { ticket: 0, user: 1, organization: 2 };
    results.sort((a, b) => typePriority[a.type] - typePriority[b.type]);

    return NextResponse.json({ results: results.slice(0, 10) });
  } catch (error) {
    console.error('Error searching:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
