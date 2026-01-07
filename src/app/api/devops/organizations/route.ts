import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';
import type { Organization } from '@/types';

// Domain mappings for organizations
const DOMAIN_MAP: Record<string, string> = {
  'Cairn Homes': 'cairnhomes.com',
  Medite: 'medite.com',
  KnowAll: 'knowall.ai',
};

// Tag mappings for organizations (SLA levels)
const TAG_MAP: Record<string, string[]> = {
  'Cairn Homes': ['gold'],
  Medite: ['silver'],
  KnowAll: [],
};

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const devopsService = new AzureDevOpsService(session.accessToken);
    const projects = await devopsService.getProjects();

    const organizations: Organization[] = projects.map(
      (project: {
        id: string;
        name: string;
        lastUpdateTime?: string;
        revision?: number;
      }) => ({
        id: project.id,
        name: project.name,
        domain: DOMAIN_MAP[project.name] || undefined,
        devOpsProject: project.name,
        devOpsOrg: 'KnowAll',
        tags: TAG_MAP[project.name] || [],
        createdAt: project.lastUpdateTime ? new Date(project.lastUpdateTime) : new Date(),
        updatedAt: project.lastUpdateTime ? new Date(project.lastUpdateTime) : new Date(),
      })
    );

    return NextResponse.json({ organizations });
  } catch (error) {
    console.error('Error fetching organizations:', error);
    return NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 });
  }
}
