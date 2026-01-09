import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import type { Organization, SLALevel } from '@/types';

interface DevOpsProjectWithDescription {
  id: string;
  name: string;
  description?: string;
  url: string;
  state: string;
  lastUpdateTime?: string;
}

// Parse email domains from description (format: "Email: domain1.com, domain2.com")
function parseEmailDomains(description?: string): string | undefined {
  if (!description) return undefined;
  const match = description.match(/email(?:\s+domains?)?\s*:\s*([^\n]+)/i);
  if (!match) return undefined;
  const domains = match[1]
    .split(/[,;\s]+/)
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.includes('.') && !d.startsWith('.'));
  return domains.length > 0 ? domains.join(', ') : undefined;
}

// Parse SLA from description (format: "SLA: Gold" or "SLA Level: Silver")
function parseSLA(description?: string): SLALevel | undefined {
  if (!description) return undefined;
  const match = description.match(/sla(?:\s+level)?\s*:\s*(\w+)/i);
  if (!match) return undefined;
  const sla = match[1].toLowerCase();
  if (sla === 'gold') return 'Gold';
  if (sla === 'silver') return 'Silver';
  if (sla === 'bronze') return 'Bronze';
  return undefined;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const devOpsOrg = process.env.AZURE_DEVOPS_ORG || 'KnowAll';
    const baseUrl = `https://dev.azure.com/${devOpsOrg}`;

    // Fetch projects with description expanded
    const response = await fetch(`${baseUrl}/_apis/projects?api-version=7.0&$expand=description`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch projects: ${response.statusText}`);
    }

    const data = await response.json();
    const devopsProjects: DevOpsProjectWithDescription[] = data.value || [];

    // Transform to Organization[] format with parsed domain and SLA
    const projects: (Organization & { sla?: SLALevel })[] = devopsProjects.map((project) => ({
      id: project.id,
      name: project.name,
      domain: parseEmailDomains(project.description),
      devOpsProject: project.name,
      devOpsOrg,
      tags: [],
      sla: parseSLA(project.description),
      createdAt: new Date(), // DevOps doesn't expose project creation date
      updatedAt: project.lastUpdateTime ? new Date(project.lastUpdateTime) : new Date(),
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
