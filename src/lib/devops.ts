// Azure DevOps API Service Layer
import type {
  DevOpsWorkItem,
  DevOpsProject,
  Ticket,
  TicketStatus,
  TicketPriority,
  Customer,
  User,
  Organization,
  TicketComment,
  SLALevel,
} from '@/types';
import { parseSLAFromDescription, calculateTicketSLA, DEFAULT_SLA_LEVEL } from './sla';

const DEVOPS_ORG = process.env.AZURE_DEVOPS_ORG || 'KnowAll';
const DEVOPS_BASE_URL = `https://dev.azure.com/${DEVOPS_ORG}`;

// Map Azure DevOps states to Zendesk-like statuses
function mapStateToStatus(state: string): TicketStatus {
  const stateMap: Record<string, TicketStatus> = {
    New: 'New',
    Active: 'Open',
    'In Progress': 'In Progress',
    Doing: 'In Progress',
    Resolved: 'Resolved',
    Closed: 'Closed',
    Done: 'Closed',
    Removed: 'Closed',
    // Custom states for support
    Pending: 'Pending',
    'Waiting for Customer': 'Pending',
    'On Hold': 'Pending',
  };
  return stateMap[state] || 'Open';
}

// Map priority numbers to Zendesk-like priorities
function mapPriority(priority?: number): TicketPriority {
  if (!priority) return 'Normal';
  if (priority === 1) return 'Urgent';
  if (priority === 2) return 'High';
  if (priority === 3) return 'Normal';
  return 'Low';
}

// Convert DevOps identity to User
function identityToUser(identity?: {
  displayName: string;
  uniqueName: string;
  id: string;
  imageUrl?: string;
}): User | undefined {
  if (!identity) return undefined;
  return {
    id: identity.id,
    displayName: identity.displayName,
    email: identity.uniqueName,
    avatarUrl: identity.imageUrl,
  };
}

// Convert DevOps identity to Customer
function identityToCustomer(identity: {
  displayName: string;
  uniqueName: string;
  id: string;
  imageUrl?: string;
}): Customer {
  return {
    id: identity.id,
    displayName: identity.displayName,
    email: identity.uniqueName,
    timezone: 'Europe/Dublin',
    tags: [],
    avatarUrl: identity.imageUrl,
    lastUpdated: new Date(),
  };
}

// Convert DevOps work item to Ticket
export function workItemToTicket(workItem: DevOpsWorkItem, organization?: Organization): Ticket {
  const fields = workItem.fields;
  return {
    id: workItem.id,
    workItemId: workItem.id,
    title: fields['System.Title'],
    description: fields['System.Description'] || '',
    status: mapStateToStatus(fields['System.State']),
    priority: mapPriority(fields['Microsoft.VSTS.Common.Priority']),
    requester: identityToCustomer(fields['System.CreatedBy']),
    assignee: identityToUser(fields['System.AssignedTo']),
    organization,
    tags:
      fields['System.Tags']
        ?.split(';')
        .map((t: string) => t.trim())
        .filter(Boolean) || [],
    createdAt: new Date(fields['System.CreatedDate']),
    updatedAt: new Date(fields['System.ChangedDate']),
    devOpsUrl:
      workItem._links?.html?.href ||
      `${DEVOPS_BASE_URL}/${fields['System.TeamProject']}/_workitems/edit/${workItem.id}`,
    project: fields['System.TeamProject'],
    comments: [],
  };
}

export class AzureDevOpsService {
  private accessToken: string;
  private organization: string;

  constructor(accessToken: string, organization: string = DEVOPS_ORG) {
    this.accessToken = accessToken;
    this.organization = organization;
  }

  private get baseUrl(): string {
    return `https://dev.azure.com/${this.organization}`;
  }

  private get headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  // Get all projects the user has access to
  async getProjects(): Promise<DevOpsProject[]> {
    const response = await fetch(`${this.baseUrl}/_apis/projects?api-version=7.0`, {
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch projects: ${response.statusText}`);
    }

    const data = await response.json();
    return data.value;
  }

  // Get work items with "ticket" tag from a specific project
  async getTickets(projectName: string, additionalFilters?: string): Promise<DevOpsWorkItem[]> {
    // WIQL query to get work items tagged as "ticket"
    const wiql = {
      query: `
        SELECT [System.Id], [System.Title], [System.State], [System.CreatedDate],
               [System.ChangedDate], [System.CreatedBy], [System.AssignedTo],
               [System.Tags], [Microsoft.VSTS.Common.Priority], [System.Description],
               [System.WorkItemType], [System.AreaPath], [System.TeamProject]
        FROM WorkItems
        WHERE [System.TeamProject] = '${projectName}'
          AND [System.Tags] CONTAINS 'ticket'
          ${additionalFilters || ''}
        ORDER BY [System.ChangedDate] DESC
      `,
    };

    const queryResponse = await fetch(
      `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/wiql?api-version=7.0`,
      {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(wiql),
      }
    );

    if (!queryResponse.ok) {
      throw new Error(`Failed to query work items: ${queryResponse.statusText}`);
    }

    const queryData = await queryResponse.json();
    const workItemIds = queryData.workItems?.map((wi: { id: number }) => wi.id) || [];

    if (workItemIds.length === 0) {
      return [];
    }

    // Fetch work item details in batches
    const batchSize = 200;
    const allWorkItems: DevOpsWorkItem[] = [];

    for (let i = 0; i < workItemIds.length; i += batchSize) {
      const batch = workItemIds.slice(i, i + batchSize);
      const workItemsResponse = await fetch(
        `${this.baseUrl}/_apis/wit/workitems?ids=${batch.join(',')}&$expand=all&api-version=7.0`,
        { headers: this.headers }
      );

      if (!workItemsResponse.ok) {
        throw new Error(`Failed to fetch work items: ${workItemsResponse.statusText}`);
      }

      const workItemsData = await workItemsResponse.json();
      allWorkItems.push(...workItemsData.value);
    }

    return allWorkItems;
  }

  // Get a single work item by ID
  async getWorkItem(projectName: string, workItemId: number): Promise<DevOpsWorkItem> {
    const response = await fetch(
      `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitems/${workItemId}?$expand=all&api-version=7.0`,
      { headers: this.headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch work item: ${response.statusText}`);
    }

    return response.json();
  }

  // Get comments for a work item
  async getWorkItemComments(projectName: string, workItemId: number): Promise<TicketComment[]> {
    const response = await fetch(
      `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitems/${workItemId}/comments?api-version=7.0-preview`,
      { headers: this.headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch comments: ${response.statusText}`);
    }

    const data = await response.json();
    return (
      data.comments?.map(
        (c: {
          id: number;
          text: string;
          createdDate: string;
          createdBy: { displayName: string; uniqueName: string; id: string };
        }) => ({
          id: c.id,
          content: c.text,
          createdAt: new Date(c.createdDate),
          author: {
            id: c.createdBy.id,
            displayName: c.createdBy.displayName,
            email: c.createdBy.uniqueName,
          },
          isInternal: false,
        })
      ) || []
    );
  }

  // Create a new work item (ticket)
  async createTicket(
    projectName: string,
    title: string,
    description: string,
    requesterEmail: string,
    priority: number = 3
  ): Promise<DevOpsWorkItem> {
    const patchDocument = [
      { op: 'add', path: '/fields/System.Title', value: title },
      { op: 'add', path: '/fields/System.Description', value: description },
      { op: 'add', path: '/fields/System.Tags', value: 'ticket' },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: priority },
      { op: 'add', path: '/fields/System.History', value: `Ticket created by ${requesterEmail}` },
    ];

    const response = await fetch(
      `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitems/$Task?api-version=7.0`,
      {
        method: 'POST',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json-patch+json',
        },
        body: JSON.stringify(patchDocument),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to create work item: ${response.statusText}`);
    }

    return response.json();
  }

  // Create a new work item (ticket) with assignee and custom tags
  async createTicketWithAssignee(
    projectName: string,
    title: string,
    description: string,
    requesterEmail: string,
    priority: number = 3,
    tags: string[] = ['ticket'],
    assigneeId?: string
  ): Promise<DevOpsWorkItem> {
    const patchDocument: Array<{ op: string; path: string; value: string | number }> = [
      { op: 'add', path: '/fields/System.Title', value: title },
      { op: 'add', path: '/fields/System.Description', value: description },
      { op: 'add', path: '/fields/System.Tags', value: tags.join('; ') },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: priority },
      { op: 'add', path: '/fields/System.History', value: `Ticket created by ${requesterEmail}` },
    ];

    if (assigneeId) {
      patchDocument.push({ op: 'add', path: '/fields/System.AssignedTo', value: assigneeId });
    }

    const response = await fetch(
      `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitems/$Task?api-version=7.0`,
      {
        method: 'POST',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json-patch+json',
        },
        body: JSON.stringify(patchDocument),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create work item: ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  // Add a comment to a work item
  async addComment(projectName: string, workItemId: number, comment: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitems/${workItemId}/comments?api-version=7.0-preview`,
      {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ text: comment }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to add comment: ${response.statusText}`);
    }
  }

  // Update work item state
  async updateTicketState(
    projectName: string,
    workItemId: number,
    state: string
  ): Promise<DevOpsWorkItem> {
    const patchDocument = [{ op: 'add', path: '/fields/System.State', value: state }];

    const response = await fetch(
      `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitems/${workItemId}?api-version=7.0`,
      {
        method: 'PATCH',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json-patch+json',
        },
        body: JSON.stringify(patchDocument),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to update work item: ${response.statusText}`);
    }

    return response.json();
  }

  // Get all tickets from all accessible projects
  async getAllTickets(): Promise<Ticket[]> {
    const projects = await this.getProjects();
    const slaMap = await getProjectSLAMap();
    const allTickets: Ticket[] = [];

    for (const project of projects) {
      try {
        const workItems = await this.getTickets(project.name);
        const slaLevel = slaMap[project.name] || DEFAULT_SLA_LEVEL;
        const organization: Organization = {
          id: project.id,
          name: project.name,
          devOpsProject: project.name,
          devOpsOrg: this.organization,
          tags: [slaLevel.toLowerCase()],
          slaLevel,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const tickets = workItems.map((wi) => {
          const ticket = workItemToTicket(wi, organization);
          // Calculate SLA info for the ticket
          ticket.slaInfo = calculateTicketSLA(ticket, slaLevel);
          return ticket;
        });
        allTickets.push(...tickets);
      } catch (error) {
        console.error(`Failed to fetch tickets from ${project.name}:`, error);
      }
    }

    return allTickets.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  // Get team members from a project
  async getTeamMembers(projectName: string): Promise<User[]> {
    const response = await fetch(
      `${this.baseUrl}/_apis/projects/${encodeURIComponent(projectName)}/teams?api-version=7.0`,
      { headers: this.headers }
    );

    if (!response.ok) {
      return [];
    }

    const teamsData = await response.json();
    const allMembers: User[] = [];

    for (const team of teamsData.value || []) {
      const membersResponse = await fetch(
        `${this.baseUrl}/_apis/projects/${encodeURIComponent(projectName)}/teams/${team.id}/members?api-version=7.0`,
        { headers: this.headers }
      );

      if (membersResponse.ok) {
        const membersData = await membersResponse.json();
        for (const member of membersData.value || []) {
          if (member.identity && !allMembers.find((m) => m.id === member.identity.id)) {
            allMembers.push({
              id: member.identity.id,
              displayName: member.identity.displayName,
              email: member.identity.uniqueName,
              avatarUrl: member.identity.imageUrl,
            });
          }
        }
      }
    }

    return allMembers;
  }
}

// Email routing: Maps email domains to DevOps projects
// Reads from project descriptions in format: "Email: domain1.com, domain2.com"
// Falls back to hardcoded defaults if DevOps query fails

interface DomainMapCache {
  map: Record<string, string>;
  timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let domainMapCache: DomainMapCache | null = null;

// Fallback mapping if DevOps query fails
const FALLBACK_DOMAIN_MAP: Record<string, string> = {
  'cairnhomes.com': 'Cairn Homes',
  'medite.com': 'Medite',
  'medite.ie': 'Medite',
  'knowall.ai': 'KnowAll',
};

// Parse project description for email domains
// Expected format in description: "Email: domain1.com, domain2.com" or "Email domains: ..."
function parseEmailDomainsFromDescription(description: string): string[] {
  if (!description) return [];

  // Match patterns like "Email: domain.com" or "Email domains: domain1.com, domain2.com"
  const emailMatch = description.match(/email(?:\s+domains?)?\s*:\s*([^\n]+)/i);
  if (!emailMatch) return [];

  return emailMatch[1]
    .split(/[,;\s]+/)
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.includes('.') && !d.startsWith('.'));
}

// Fetch domain map from DevOps project descriptions
async function fetchDomainMapFromDevOps(): Promise<Record<string, string>> {
  const pat = process.env.AZURE_DEVOPS_PAT;
  const org = process.env.AZURE_DEVOPS_ORG || 'KnowAll';

  if (!pat) {
    console.warn('AZURE_DEVOPS_PAT not set, using fallback domain map');
    return FALLBACK_DOMAIN_MAP;
  }

  try {
    const response = await fetch(
      `https://dev.azure.com/${org}/_apis/projects?api-version=7.0&$expand=description`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(':' + pat).toString('base64')}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch projects: ${response.statusText}`);
    }

    const data = await response.json();
    const domainMap: Record<string, string> = {};

    for (const project of data.value || []) {
      const domains = parseEmailDomainsFromDescription(project.description || '');
      for (const domain of domains) {
        domainMap[domain] = project.name;
      }
    }

    // If no domains found in any project, use fallback
    if (Object.keys(domainMap).length === 0) {
      console.warn('No email domains found in DevOps project descriptions, using fallback');
      return FALLBACK_DOMAIN_MAP;
    }

    return domainMap;
  } catch (error) {
    console.error('Failed to fetch domain map from DevOps:', error);
    return FALLBACK_DOMAIN_MAP;
  }
}

// Get domain map with caching
export async function getProjectDomainMap(): Promise<Record<string, string>> {
  const now = Date.now();

  if (domainMapCache && now - domainMapCache.timestamp < CACHE_TTL_MS) {
    return domainMapCache.map;
  }

  const map = await fetchDomainMapFromDevOps();
  domainMapCache = { map, timestamp: now };
  return map;
}

// Get project name from email address
export async function getProjectFromEmail(email: string): Promise<string | undefined> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return undefined;

  const domainMap = await getProjectDomainMap();
  return domainMap[domain];
}

// Clear cache (useful for testing or when project descriptions change)
export function clearDomainMapCache(): void {
  domainMapCache = null;
}

// SLA Level Map - Maps project names to SLA levels
// Reads from project descriptions in format: "SLA: Gold" or "sla=silver"

interface SLAMapCache {
  map: Record<string, SLALevel>;
  timestamp: number;
}

let slaMapCache: SLAMapCache | null = null;

// Fallback SLA mapping if DevOps query fails
const FALLBACK_SLA_MAP: Record<string, SLALevel> = {
  'Cairn Homes': 'Gold',
  Medite: 'Silver',
  KnowAll: 'Bronze',
};

// Fetch SLA map from DevOps project descriptions
async function fetchSLAMapFromDevOps(): Promise<Record<string, SLALevel>> {
  const pat = process.env.AZURE_DEVOPS_PAT;
  const org = process.env.AZURE_DEVOPS_ORG || 'KnowAll';

  if (!pat) {
    console.warn('AZURE_DEVOPS_PAT not set, using fallback SLA map');
    return FALLBACK_SLA_MAP;
  }

  try {
    const response = await fetch(
      `https://dev.azure.com/${org}/_apis/projects?api-version=7.0&$expand=description`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(':' + pat).toString('base64')}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch projects: ${response.statusText}`);
    }

    const data = await response.json();
    const slaMap: Record<string, SLALevel> = {};

    for (const project of data.value || []) {
      const slaLevel = parseSLAFromDescription(project.description || '');
      if (slaLevel) {
        slaMap[project.name] = slaLevel;
      }
    }

    // Merge with fallback for projects without SLA in description
    return { ...FALLBACK_SLA_MAP, ...slaMap };
  } catch (error) {
    console.error('Failed to fetch SLA map from DevOps:', error);
    return FALLBACK_SLA_MAP;
  }
}

// Get SLA map with caching
export async function getProjectSLAMap(): Promise<Record<string, SLALevel>> {
  const now = Date.now();

  if (slaMapCache && now - slaMapCache.timestamp < CACHE_TTL_MS) {
    return slaMapCache.map;
  }

  const map = await fetchSLAMapFromDevOps();
  slaMapCache = { map, timestamp: now };
  return map;
}

// Get SLA level for a specific project
export async function getSLALevelForProject(projectName: string): Promise<SLALevel> {
  const slaMap = await getProjectSLAMap();
  return slaMap[projectName] || DEFAULT_SLA_LEVEL;
}

// Clear SLA cache (useful for testing or when project descriptions change)
export function clearSLAMapCache(): void {
  slaMapCache = null;
}
