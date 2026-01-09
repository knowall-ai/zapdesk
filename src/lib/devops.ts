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
} from '@/types';

const DEVOPS_ORG = process.env.AZURE_DEVOPS_ORG || 'KnowAll';
const DEVOPS_BASE_URL = `https://dev.azure.com/${DEVOPS_ORG}`;

// Map Azure DevOps state category to Zendesk-like status
// Categories are consistent across all process templates (Basic, Agile, Scrum, CMMI)
function mapCategoryToStatus(category: string): TicketStatus {
  const categoryMap: Record<string, TicketStatus> = {
    Proposed: 'New',
    InProgress: 'In Progress',
    Resolved: 'Resolved',
    Completed: 'Closed',
    Removed: 'Closed',
  };
  return categoryMap[category] || 'Open';
}

// Cache for state-to-category mapping (populated by fetchStateCategories)
let stateCategoryCache: Record<string, string> = {};

// Set the state category cache (called from API routes after fetching states)
export function setStateCategoryCache(stateCategories: Record<string, string>) {
  stateCategoryCache = stateCategories;
}

// Map Azure DevOps state to Zendesk-like status using cached categories
function mapStateToStatus(state: string): TicketStatus {
  const category = stateCategoryCache[state];
  if (category) {
    return mapCategoryToStatus(category);
  }
  // Fallback for common states if cache not populated
  if (state === 'New') return 'New';
  if (state === 'Closed' || state === 'Done' || state === 'Removed') return 'Closed';
  if (state === 'Resolved') return 'Resolved';
  return 'Open';
}

// Map Zendesk-like statuses back to Azure DevOps states
export function mapStatusToState(status: TicketStatus): string {
  const statusMap: Record<TicketStatus, string> = {
    New: 'New',
    Open: 'Active',
    'In Progress': 'Active',
    Pending: 'Blocked',
    Resolved: 'Resolved',
    Closed: 'Closed',
  };
  return statusMap[status] || 'Active';
}

// Map priority numbers to Zendesk-like priorities
function mapPriority(priority?: number): TicketPriority | undefined {
  if (!priority) return undefined;
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
    devOpsState: fields['System.State'], // Preserve original DevOps state
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

  // Get work items from a specific project
  // By default, filters to work items with "ticket" tag
  // Set ticketsOnly=false to get all work items regardless of tags
  async getTickets(
    projectName: string,
    options?: { additionalFilters?: string; ticketsOnly?: boolean }
  ): Promise<DevOpsWorkItem[]> {
    const { additionalFilters, ticketsOnly = true } = options || {};

    // WIQL query - optionally filter by "ticket" tag
    const ticketTagClause = ticketsOnly ? "AND [System.Tags] CONTAINS 'ticket'" : '';
    const wiql = {
      query: `
        SELECT [System.Id], [System.Title], [System.State], [System.CreatedDate],
               [System.ChangedDate], [System.CreatedBy], [System.AssignedTo],
               [System.Tags], [Microsoft.VSTS.Common.Priority], [System.Description],
               [System.WorkItemType], [System.AreaPath], [System.TeamProject]
        FROM WorkItems
        WHERE [System.TeamProject] = '${projectName}'
          ${ticketTagClause}
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
          createdBy: { displayName: string; uniqueName: string; id: string; imageUrl?: string };
        }) => ({
          id: c.id,
          content: c.text,
          createdAt: new Date(c.createdDate),
          author: {
            id: c.createdBy.id,
            displayName: c.createdBy.displayName,
            email: c.createdBy.uniqueName,
            avatarUrl: c.createdBy.imageUrl,
          },
          isInternal: false,
        })
      ) || []
    );
  }

  // Create a new work item (ticket)
  // workItemType: the type to create (e.g., "Task", "Issue") - depends on process template
  // hasPriority: whether the process template supports Priority field
  async createTicket(
    projectName: string,
    title: string,
    description: string,
    _requesterEmail: string,
    priority: number = 3,
    workItemType: string = 'Task',
    hasPriority: boolean = true
  ): Promise<DevOpsWorkItem> {
    const patchDocument: Array<{ op: string; path: string; value: string | number }> = [
      { op: 'add', path: '/fields/System.Title', value: title },
      { op: 'add', path: '/fields/System.Description', value: description },
      { op: 'add', path: '/fields/System.Tags', value: 'ticket' },
    ];

    // Only add Priority if the template supports it
    if (hasPriority) {
      patchDocument.push({
        op: 'add',
        path: '/fields/Microsoft.VSTS.Common.Priority',
        value: priority,
      });
    }

    const response = await fetch(
      `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitems/$${workItemType}?api-version=7.0`,
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
  // workItemType: the type to create (e.g., "Task", "Issue") - depends on process template
  // hasPriority: whether the process template supports Priority field
  async createTicketWithAssignee(
    projectName: string,
    title: string,
    description: string,
    _requesterEmail: string,
    priority: number = 3,
    tags: string[] = ['ticket'],
    assigneeId?: string,
    workItemType: string = 'Task',
    hasPriority: boolean = true
  ): Promise<DevOpsWorkItem> {
    const patchDocument: Array<{ op: string; path: string; value: string | number }> = [
      { op: 'add', path: '/fields/System.Title', value: title },
      { op: 'add', path: '/fields/System.Description', value: description },
      { op: 'add', path: '/fields/System.Tags', value: tags.join('; ') },
    ];

    // Only add Priority if the template supports it
    if (hasPriority) {
      patchDocument.push({
        op: 'add',
        path: '/fields/Microsoft.VSTS.Common.Priority',
        value: priority,
      });
    }

    if (assigneeId) {
      patchDocument.push({ op: 'add', path: '/fields/System.AssignedTo', value: assigneeId });
    }

    const response = await fetch(
      `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitems/$${workItemType}?api-version=7.0`,
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

  // Update work item fields (assignee, priority)
  async updateTicketFields(
    projectName: string,
    workItemId: number,
    updates: {
      assignee?: string | null;
      priority?: number;
    }
  ): Promise<DevOpsWorkItem> {
    const patchDocument: Array<{ op: string; path: string; value: string | number | null }> = [];

    if (updates.assignee !== undefined) {
      if (updates.assignee === null) {
        // Remove assignee
        patchDocument.push({ op: 'remove', path: '/fields/System.AssignedTo', value: null });
      } else {
        patchDocument.push({
          op: 'add',
          path: '/fields/System.AssignedTo',
          value: updates.assignee,
        });
      }
    }

    if (updates.priority !== undefined) {
      patchDocument.push({
        op: 'add',
        path: '/fields/Microsoft.VSTS.Common.Priority',
        value: updates.priority,
      });
    }

    if (patchDocument.length === 0) {
      throw new Error('No updates provided');
    }

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
      const errorText = await response.text();
      throw new Error(`Failed to update work item: ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  // Get all tickets from all accessible projects
  // Set ticketsOnly=false to get all work items (not just those tagged as "ticket")
  async getAllTickets(ticketsOnly: boolean = true): Promise<Ticket[]> {
    const projects = await this.getProjects();
    const allTickets: Ticket[] = [];

    for (const project of projects) {
      try {
        const workItems = await this.getTickets(project.name, { ticketsOnly });
        const organization: Organization = {
          id: project.id,
          name: project.name,
          devOpsProject: project.name,
          devOpsOrg: this.organization,
          tags: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const tickets = workItems.map((wi) => workItemToTicket(wi, organization));
        allTickets.push(...tickets);
      } catch (error) {
        console.error(`Failed to fetch tickets from ${project.name}:`, error);
      }
    }

    return allTickets.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  // Get all users from the organization (from User Entitlements API)
  async getOrganizationUsers(): Promise<User[]> {
    const users: User[] = [];
    let continuationToken: string | null = null;

    do {
      const url = new URL(
        `https://vsaex.dev.azure.com/${this.organization}/_apis/userentitlements`
      );
      url.searchParams.set('api-version', '7.0');
      if (continuationToken) {
        url.searchParams.set('continuationToken', continuationToken);
      }

      const response = await fetch(url.toString(), { headers: this.headers });

      if (!response.ok) {
        console.error('Failed to fetch organization users:', response.status, response.statusText);
        break;
      }

      const data = await response.json();

      for (const item of data.members || []) {
        const user = item.user;
        if (user) {
          users.push({
            id: user.originId || user.descriptor,
            displayName: user.displayName,
            email: user.mailAddress || user.principalName,
            avatarUrl: user.imageUrl,
            accessLevel: item.accessLevel?.accountLicenseType,
            licenseType: item.accessLevel?.licensingSource,
          });
        }
      }

      // Check for continuation token in response headers
      continuationToken = response.headers.get('x-ms-continuationtoken');
    } while (continuationToken);

    return users;
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

  // Get current user's profile from Azure DevOps
  async getUserProfile(): Promise<{
    id: string;
    displayName: string;
    emailAddress: string;
    coreAttributes?: {
      TimeZone?: { value: string };
      Language?: { value: string };
      Country?: { value: string };
      DatePattern?: { value: string };
      TimePattern?: { value: string };
    };
  }> {
    // Use VSSPS API for profile data with core attributes
    const response = await fetch(
      'https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.0&details=true&coreAttributes=Country,TimeZone,Language,DatePattern,TimePattern',
      { headers: this.headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch user profile: ${response.statusText}`);
    }

    return response.json();
  }

  // Get user's full settings including locale preferences
  async getUserSettings(): Promise<{
    timezone: string;
    locale: string;
    country: string;
    datePattern: string;
    timePattern: string;
  }> {
    try {
      // Try to get user preferences from organization settings API
      const prefsResponse = await fetch(
        `${this.baseUrl}/_apis/settings/entries/me/UserPreferences?api-version=7.0`,
        { headers: this.headers }
      );

      if (prefsResponse.ok) {
        const prefs = await prefsResponse.json();
        // Parse the settings from the response
        const getValue = (key: string) => prefs.value?.[key]?.value || prefs[key] || '';

        return {
          timezone: getValue('TimeZone') || getValue('timezone') || '',
          locale: getValue('Language') || getValue('locale') || '',
          country: getValue('Country') || getValue('country') || '',
          datePattern: getValue('DatePattern') || getValue('datePattern') || '',
          timePattern: getValue('TimePattern') || getValue('timePattern') || '',
        };
      }

      // Fallback to profile coreAttributes
      const profile = await this.getUserProfile();
      return {
        timezone: profile.coreAttributes?.TimeZone?.value || '',
        locale: profile.coreAttributes?.Language?.value || '',
        country: profile.coreAttributes?.Country?.value || '',
        datePattern: profile.coreAttributes?.DatePattern?.value || '',
        timePattern: profile.coreAttributes?.TimePattern?.value || '',
      };
    } catch {
      return {
        timezone: '',
        locale: '',
        country: '',
        datePattern: '',
        timePattern: '',
      };
    }
  }

  // Get user entitlements (license info) from Azure DevOps
  async getUserEntitlements(): Promise<Map<string, string>> {
    const licenseMap = new Map<string, string>();

    try {
      // Use VSAEX API for user entitlements
      const response = await fetch(
        `https://vsaex.dev.azure.com/${this.organization}/_apis/userentitlements?api-version=7.0&top=500`,
        { headers: this.headers }
      );

      if (!response.ok) {
        console.error('Failed to fetch user entitlements:', response.statusText);
        return licenseMap;
      }

      const data = await response.json();
      for (const member of data.members || []) {
        const email = member.user?.principalName?.toLowerCase();
        const license =
          member.accessLevel?.licenseDisplayName || member.accessLevel?.accountLicenseType;
        if (email && license) {
          licenseMap.set(email, license);
        }
      }
    } catch (error) {
      console.error('Error fetching user entitlements:', error);
    }

    return licenseMap;
  }

  // Get all users with their entitlement/license info
  async getAllUsersWithEntitlements(): Promise<
    Array<{
      id: string;
      displayName: string;
      email: string;
      license: string;
      avatarUrl?: string;
    }>
  > {
    const users: Array<{
      id: string;
      displayName: string;
      email: string;
      license: string;
      avatarUrl?: string;
    }> = [];

    try {
      const response = await fetch(
        `https://vsaex.dev.azure.com/${this.organization}/_apis/userentitlements?api-version=7.0&top=500`,
        { headers: this.headers }
      );

      if (!response.ok) {
        console.error('Failed to fetch user entitlements:', response.statusText);
        return users;
      }

      const data = await response.json();
      for (const member of data.members || []) {
        const email = member.user?.principalName;
        const displayName = member.user?.displayName || email;
        const id = member.id || member.user?.id || email;
        const license =
          member.accessLevel?.licenseDisplayName || member.accessLevel?.accountLicenseType;
        const avatarUrl = member.user?.imageUrl;

        if (email && license) {
          users.push({
            id,
            displayName,
            email,
            license,
            avatarUrl,
          });
        }
      }
    } catch (error) {
      console.error('Error fetching user entitlements:', error);
    }

    return users;
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
