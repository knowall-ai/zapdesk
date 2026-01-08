import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';
import type { Organization } from '@/types';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const devopsService = new AzureDevOpsService(session.accessToken);
    const devopsProjects = await devopsService.getProjects();
    const devOpsOrg = process.env.AZURE_DEVOPS_ORG || 'KnowAll';

    // Transform DevOpsProject[] to Organization[] format
    const projects: Organization[] = devopsProjects.map((project) => ({
      id: project.id,
      name: project.name,
      devOpsProject: project.name,
      devOpsOrg,
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    return NextResponse.json({
      projects,
      total: projects.length,
    });
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
  }
}
