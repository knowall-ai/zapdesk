import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { validateOrganizationAccess } from '@/lib/devops-auth';
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

    const organization = request.headers.get('x-devops-org');
    if (!organization) {
      return NextResponse.json({ error: 'No organization specified' }, { status: 400 });
    }

    const hasAccess = await validateOrganizationAccess(session.accessToken, organization);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q')?.toLowerCase().trim();

    if (!query || query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const devopsService = new AzureDevOpsService(session.accessToken, organization);
    const results: SearchResult[] = [];

    // Numeric-only queries are almost always direct work item ID lookups
    // (e.g. "5908"). The tag-filtered ticket search misses any work item that
    // isn't tagged "ticket" — Checkpoints, Features, Bugs surfaced on the
    // Kanban board, etc. — so do an org-level lookup first.
    if (/^\d+$/.test(query)) {
      try {
        const workItem = await devopsService.findWorkItemById(parseInt(query, 10));
        if (workItem) {
          const fields = workItem.fields || {};
          const id = workItem.id.toString();
          const title = (fields['System.Title'] as string | undefined) || `#${id}`;
          const state = (fields['System.State'] as string | undefined) || '';
          const type = (fields['System.WorkItemType'] as string | undefined) || 'Work Item';
          results.push({
            type: 'ticket',
            id,
            title,
            subtitle: `${type} #${id}${state ? ` • ${state}` : ''}`,
            url: `/tickets/${id}`,
            status: state,
          });
          // Direct hit — skip the full getAllTickets() scan and the
          // org/user searches (a pure-digit query won't match those).
          return NextResponse.json({ results });
        }
      } catch (err) {
        console.error('Direct work item lookup failed:', err);
        // Fall through to the tag-filtered search below
      }
    }

    // Search across all work items the user can access — not just those tagged
    // "ticket". The Kanban board surfaces Checkpoints, Features, Bugs, etc.,
    // and users expect global search to find them too.
    const tickets = await devopsService.getAllTickets(false);
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
        url: `/projects/${p.id}`,
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
