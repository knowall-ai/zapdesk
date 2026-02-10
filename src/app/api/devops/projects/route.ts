import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { validateOrganizationAccess } from '@/lib/devops-auth';
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

// Cache for process ID to name mapping (per organization) with TTL
interface CacheEntry {
  data: Map<string, string>;
  timestamp: number;
}
const processNameCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL
const MAX_CACHE_SIZE = 50; // Maximum number of organizations to cache

// Clean up expired cache entries
function cleanupCache(): void {
  const now = Date.now();
  for (const [key, entry] of processNameCache) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      processNameCache.delete(key);
    }
  }
  // If still over limit, remove oldest entries
  if (processNameCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(processNameCache.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    );
    const toRemove = entries.slice(0, processNameCache.size - MAX_CACHE_SIZE);
    for (const [key] of toRemove) {
      processNameCache.delete(key);
    }
  }
}

// Fetch all processes for an organization and cache the ID->name mapping
async function fetchProcesses(baseUrl: string, accessToken: string): Promise<Map<string, string>> {
  const cacheKey = baseUrl;
  const now = Date.now();

  // Check cache with TTL
  const cached = processNameCache.get(cacheKey);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  // Clean up old entries periodically
  cleanupCache();

  const processMap = new Map<string, string>();
  try {
    // Use the Work Processes API to get all available processes
    const response = await fetch(`${baseUrl}/_apis/work/processes?api-version=7.1`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      for (const process of data.value || []) {
        if (process.typeId && process.name) {
          processMap.set(process.typeId, process.name);
        }
      }
    }
  } catch (error) {
    console.error('Failed to fetch processes:', error);
  }

  processNameCache.set(cacheKey, { data: processMap, timestamp: now });
  return processMap;
}

// Fetch process template for a project
async function fetchProjectProcess(
  baseUrl: string,
  projectId: string,
  accessToken: string,
  processMap: Map<string, string>
): Promise<ProjectProcess> {
  try {
    // Get project properties which includes process template info
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
      return {
        projectId,
        processTemplate: 'Unknown',
        isSupported: false,
      };
    }

    const propsData = await propsResponse.json();
    const properties = propsData.value || [];

    // Get the ProcessTemplateType - this is the base process type GUID that matches available processes
    const processTemplateTypeProp = properties.find(
      (p: { name: string; value: string }) => p.name === 'System.ProcessTemplateType'
    );

    let processTemplate = 'Unknown';

    if (processTemplateTypeProp?.value) {
      // Look up the process name from the ProcessTemplateType ID
      processTemplate = processMap.get(processTemplateTypeProp.value) || 'Unknown';
    }

    // Fallback to CurrentProcessTemplateId if ProcessTemplateType lookup failed
    if (processTemplate === 'Unknown') {
      const currentProcessIdProp = properties.find(
        (p: { name: string; value: string }) => p.name === 'System.CurrentProcessTemplateId'
      );
      if (currentProcessIdProp?.value) {
        processTemplate = processMap.get(currentProcessIdProp.value) || 'Unknown';
      }
    }

    // Final fallback to System.Process Template name if all lookups failed
    if (processTemplate === 'Unknown') {
      const templateNameProp = properties.find(
        (p: { name: string; value: string }) => p.name === 'System.Process Template'
      );
      processTemplate = templateNameProp?.value || 'Unknown';
    }

    const supported = isTemplateSupported(processTemplate);

    return {
      projectId,
      processTemplate,
      isSupported: supported,
      config: supported ? getTemplateConfig(processTemplate) : undefined,
    };
  } catch (error) {
    console.error(`[fetchProjectProcess] Failed to fetch process for project ${projectId}:`, error);
    return {
      projectId,
      processTemplate: 'Unknown',
      isSupported: false,
    };
  }
}

// Fetch Epic count for a project using WIQL
async function fetchEpicCount(
  baseUrl: string,
  projectName: string,
  accessToken: string
): Promise<number> {
  try {
    const wiqlQuery = {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${projectName.replace(/'/g, "''")}' AND [System.WorkItemType] = 'Epic'`,
    };

    const response = await fetch(
      `${baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/wiql?api-version=7.0`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(wiqlQuery),
      }
    );

    if (!response.ok) {
      return 0;
    }

    const data = await response.json();
    return data.workItems?.length || 0;
  } catch (error) {
    console.error(`[fetchEpicCount] Failed to fetch Epic count for ${projectName}:`, error);
    return 0;
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

    // Validate user has access to the requested organization
    const hasAccess = await validateOrganizationAccess(session.accessToken, devOpsOrg);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Access denied to the specified organization' },
        { status: 403 }
      );
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

    // First fetch all available processes to get ID->name mapping
    const processMap = await fetchProcesses(baseUrl, session.accessToken!);

    // Fetch process template info and Epic counts for all projects in parallel
    const processInfoPromises = devopsProjects.map((project) =>
      fetchProjectProcess(baseUrl, project.id, session.accessToken!, processMap)
    );
    const epicCountPromises = devopsProjects.map((project) =>
      fetchEpicCount(baseUrl, project.name, session.accessToken!)
    );

    const [processInfos, epicCounts] = await Promise.all([
      Promise.all(processInfoPromises),
      Promise.all(epicCountPromises),
    ]);

    // Create maps for quick lookup
    const processInfoMap = new Map(processInfos.map((p) => [p.projectId, p]));
    const epicCountMap = new Map(devopsProjects.map((p, i) => [p.id, epicCounts[i]]));

    // Transform to Organization[] format with parsed domain, SLA, process template, and Epic count
    const projects: (Organization & {
      sla?: SLALevel;
      processTemplate?: string;
      isTemplateSupported?: boolean;
      epicCount?: number;
    })[] = devopsProjects.map((project) => {
      const processInfo = processInfoMap.get(project.id);
      return {
        id: project.id,
        name: project.name,
        description: project.description,
        domain: parseEmailDomains(project.description),
        devOpsProject: project.name,
        devOpsOrg,
        tags: [],
        sla: parseSLA(project.description),
        processTemplate: processInfo?.processTemplate,
        isTemplateSupported: processInfo?.isSupported ?? false,
        epicCount: epicCountMap.get(project.id) ?? 0,
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
