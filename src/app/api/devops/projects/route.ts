import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import type { Organization, SLALevel } from '@/types';
import { isTemplateSupported, getTemplateConfig } from '@/config/process-templates';
import type { ProcessTemplateConfig } from '@/config/process-templates';

interface DevOpsProjectWithDescription {
  id: string;
  name: string;
  description?: string;
  url: string;
  state: string;
  lastUpdateTime?: string;
}

interface ProjectProcess {
  projectId: string;
  processTemplate: string;
  isSupported: boolean;
  config?: ProcessTemplateConfig;
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

// Fetch process template for a project
async function fetchProjectProcess(
  baseUrl: string,
  projectId: string,
  accessToken: string
): Promise<ProjectProcess> {
  try {
    // Get project properties which includes process template info
    // Using api-version=7.1-preview.1 as recommended by Azure DevOps docs
    const propsResponse = await fetch(
      `${baseUrl}/_apis/projects/${projectId}/properties?api-version=7.1-preview.1`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!propsResponse.ok) {
      // Fallback to default template if we can't fetch properties
      return {
        projectId,
        processTemplate: 'Unknown',
        isSupported: false,
      };
    }

    const propsData = await propsResponse.json();
    const properties = propsData.value || [];

    // Look for process template name property
    // Azure DevOps uses "System.Process Template" for the human-readable name (e.g., "Scrum", "Basic")
    // and "System.ProcessTemplateType" for the GUID - we want the name, not the GUID
    const templateNameProp = properties.find(
      (p: { name: string; value: string }) => p.name === 'System.Process Template'
    );

    const processTemplate = templateNameProp?.value || 'Unknown';
    const supported = isTemplateSupported(processTemplate);

    return {
      projectId,
      processTemplate,
      isSupported: supported,
      config: supported ? getTemplateConfig(processTemplate) : undefined,
    };
  } catch {
    return {
      projectId,
      processTemplate: 'Unknown',
      isSupported: false,
    };
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get organization from header (client sends from localStorage selection)
    const devOpsOrg = request.headers.get('x-devops-org');

    if (!devOpsOrg) {
      return NextResponse.json({ error: 'No organization specified' }, { status: 400 });
    }

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

    // Fetch process template info for all projects in parallel
    const processInfoPromises = devopsProjects.map((project) =>
      fetchProjectProcess(baseUrl, project.id, session.accessToken!)
    );
    const processInfos = await Promise.all(processInfoPromises);

    // Create a map for quick lookup
    const processInfoMap = new Map(processInfos.map((p) => [p.projectId, p]));

    // Transform to Organization[] format with parsed domain, SLA, and process template
    const projects: (Organization & {
      sla?: SLALevel;
      processTemplate?: string;
      isTemplateSupported?: boolean;
    })[] = devopsProjects.map((project) => {
      const processInfo = processInfoMap.get(project.id);
      return {
        id: project.id,
        name: project.name,
        domain: parseEmailDomains(project.description),
        devOpsProject: project.name,
        devOpsOrg,
        tags: [],
        sla: parseSLA(project.description),
        processTemplate: processInfo?.processTemplate,
        isTemplateSupported: processInfo?.isSupported ?? false,
        createdAt: new Date(), // DevOps doesn't expose project creation date
        updatedAt: project.lastUpdateTime ? new Date(project.lastUpdateTime) : new Date(),
      };
    });

    return NextResponse.json({
      projects,
      total: projects.length,
    });
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
  }
}
