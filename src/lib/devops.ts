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
  Epic,
  Feature,
  WorkItem,
  EpicType,
  TreemapNode,
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

  // Get all Epics from a project
  async getEpics(projectName: string): Promise<Epic[]> {
    const wiql = {
      query: `
        SELECT [System.Id], [System.Title], [System.State], [System.CreatedDate],
               [System.ChangedDate], [System.Description], [System.Tags],
               [System.AreaPath], [System.TeamProject],
               [Microsoft.VSTS.Scheduling.CompletedWork],
               [Microsoft.VSTS.Scheduling.RemainingWork],
               [Microsoft.VSTS.Scheduling.OriginalEstimate]
        FROM WorkItems
        WHERE [System.TeamProject] = '${projectName}'
          AND [System.WorkItemType] = 'Epic'
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
      throw new Error(`Failed to query epics: ${queryResponse.statusText}`);
    }

    const queryData = await queryResponse.json();
    const workItemIds = queryData.workItems?.map((wi: { id: number }) => wi.id) || [];

    if (workItemIds.length === 0) {
      return [];
    }

    // Fetch work item details
    const workItemsResponse = await fetch(
      `${this.baseUrl}/_apis/wit/workitems?ids=${workItemIds.join(',')}&$expand=all&api-version=7.0`,
      { headers: this.headers }
    );

    if (!workItemsResponse.ok) {
      throw new Error(`Failed to fetch epics: ${workItemsResponse.statusText}`);
    }

    const workItemsData = await workItemsResponse.json();
    return workItemsData.value.map((wi: DevOpsWorkItem) => this.mapToEpic(wi));
  }

  // Get Features under an Epic
  async getFeaturesByEpic(projectName: string, epicId: number): Promise<Feature[]> {
    // Use work item links to get children
    const response = await fetch(
      `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitems/${epicId}?$expand=relations&api-version=7.0`,
      { headers: this.headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch epic relations: ${response.statusText}`);
    }

    const epicData = await response.json();
    const childIds: number[] = [];

    // Find child links (Features)
    for (const relation of epicData.relations || []) {
      if (relation.rel === 'System.LinkTypes.Hierarchy-Forward' && relation.url) {
        const idMatch = relation.url.match(/workItems\/(\d+)/);
        if (idMatch) {
          childIds.push(parseInt(idMatch[1], 10));
        }
      }
    }

    if (childIds.length === 0) {
      return [];
    }

    // Fetch Feature details
    const featuresResponse = await fetch(
      `${this.baseUrl}/_apis/wit/workitems?ids=${childIds.join(',')}&$expand=all&api-version=7.0`,
      { headers: this.headers }
    );

    if (!featuresResponse.ok) {
      throw new Error(`Failed to fetch features: ${featuresResponse.statusText}`);
    }

    const featuresData = await featuresResponse.json();
    return featuresData.value
      .filter((wi: DevOpsWorkItem) => wi.fields['System.WorkItemType'] === 'Feature')
      .map((wi: DevOpsWorkItem) => this.mapToFeature(wi, epicId));
  }

  // Get Work Items under a Feature
  async getWorkItemsByFeature(projectName: string, featureId: number): Promise<WorkItem[]> {
    const response = await fetch(
      `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitems/${featureId}?$expand=relations&api-version=7.0`,
      { headers: this.headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch feature relations: ${response.statusText}`);
    }

    const featureData = await response.json();
    const childIds: number[] = [];

    // Find child links (Work Items: User Story, Task, Bug, etc.)
    for (const relation of featureData.relations || []) {
      if (relation.rel === 'System.LinkTypes.Hierarchy-Forward' && relation.url) {
        const idMatch = relation.url.match(/workItems\/(\d+)/);
        if (idMatch) {
          childIds.push(parseInt(idMatch[1], 10));
        }
      }
    }

    if (childIds.length === 0) {
      return [];
    }

    // Fetch Work Item details
    const workItemsResponse = await fetch(
      `${this.baseUrl}/_apis/wit/workitems?ids=${childIds.join(',')}&$expand=all&api-version=7.0`,
      { headers: this.headers }
    );

    if (!workItemsResponse.ok) {
      throw new Error(`Failed to fetch work items: ${workItemsResponse.statusText}`);
    }

    const workItemsData = await workItemsResponse.json();
    return workItemsData.value.map((wi: DevOpsWorkItem) => this.mapToWorkItem(wi, featureId));
  }

  // Get full Epic hierarchy with Features and Work Items for treemap
  async getEpicHierarchy(projectName: string, epicId: number): Promise<Epic> {
    // Get epic details
    const epicResponse = await fetch(
      `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitems/${epicId}?$expand=all&api-version=7.0`,
      { headers: this.headers }
    );

    if (!epicResponse.ok) {
      throw new Error(`Failed to fetch epic: ${epicResponse.statusText}`);
    }

    const epicData = await epicResponse.json();
    const epic = this.mapToEpic(epicData);

    // Get features
    const features = await this.getFeaturesByEpic(projectName, epicId);

    // Get work items for each feature
    for (const feature of features) {
      feature.workItems = await this.getWorkItemsByFeature(projectName, feature.id);
      // Calculate totals
      feature.completedWork = feature.workItems.reduce((sum, wi) => sum + wi.completedWork, 0);
      feature.remainingWork = feature.workItems.reduce((sum, wi) => sum + wi.remainingWork, 0);
      feature.totalWork = feature.completedWork + feature.remainingWork;
    }

    epic.features = features;
    // Calculate totals for epic
    epic.completedWork = features.reduce((sum, f) => sum + f.completedWork, 0);
    epic.remainingWork = features.reduce((sum, f) => sum + f.remainingWork, 0);
    epic.totalWork = epic.completedWork + epic.remainingWork;

    return epic;
  }

  // Convert Epic hierarchy to Treemap data structure
  epicToTreemap(epic: Epic): TreemapNode {
    return {
      name: epic.title,
      id: epic.id,
      value: epic.totalWork || 1, // Use 1 as minimum to ensure visibility
      state: epic.state,
      type: 'epic',
      devOpsUrl: epic.devOpsUrl,
      children: epic.features.map((feature) => ({
        name: feature.title,
        id: feature.id,
        value: feature.totalWork || 1,
        state: feature.state,
        type: 'feature' as const,
        priority: feature.priority,
        devOpsUrl: feature.devOpsUrl,
        children: feature.workItems.map((wi) => ({
          name: wi.title,
          id: wi.id,
          value: wi.completedWork || wi.originalEstimate || 1,
          state: wi.state,
          type: 'workitem' as const,
          priority: wi.priority,
          workItemType: wi.workItemType,
          devOpsUrl: wi.devOpsUrl,
        })),
      })),
    };
  }

  // Helper: Map DevOps work item to Epic
  private mapToEpic(wi: DevOpsWorkItem): Epic {
    const fields = wi.fields;
    const tags =
      fields['System.Tags']
        ?.split(';')
        .map((t: string) => t.trim())
        .filter(Boolean) || [];

    // Determine Epic type from tags or area path
    let epicType: EpicType = 'Agile';
    if (
      tags.includes('CISP') ||
      tags.includes('cisp') ||
      fields['System.AreaPath']?.toLowerCase().includes('cisp')
    ) {
      epicType = 'CISP';
    }

    return {
      id: wi.id,
      title: fields['System.Title'],
      description: fields['System.Description'] || '',
      state: fields['System.State'],
      epicType,
      areaPath: fields['System.AreaPath'],
      project: fields['System.TeamProject'],
      createdAt: new Date(fields['System.CreatedDate']),
      updatedAt: new Date(fields['System.ChangedDate']),
      completedWork: (fields['Microsoft.VSTS.Scheduling.CompletedWork'] as number) || 0,
      remainingWork: (fields['Microsoft.VSTS.Scheduling.RemainingWork'] as number) || 0,
      totalWork: 0, // Will be calculated from features
      features: [],
      devOpsUrl:
        wi._links?.html?.href ||
        `${DEVOPS_BASE_URL}/${fields['System.TeamProject']}/_workitems/edit/${wi.id}`,
      tags,
    };
  }

  // Helper: Map DevOps work item to Feature
  private mapToFeature(wi: DevOpsWorkItem, parentId?: number): Feature {
    const fields = wi.fields;
    return {
      id: wi.id,
      title: fields['System.Title'],
      description: fields['System.Description'] || '',
      state: fields['System.State'],
      parentId,
      areaPath: fields['System.AreaPath'],
      project: fields['System.TeamProject'],
      createdAt: new Date(fields['System.CreatedDate']),
      updatedAt: new Date(fields['System.ChangedDate']),
      completedWork: (fields['Microsoft.VSTS.Scheduling.CompletedWork'] as number) || 0,
      remainingWork: (fields['Microsoft.VSTS.Scheduling.RemainingWork'] as number) || 0,
      totalWork: 0,
      workItems: [],
      devOpsUrl:
        wi._links?.html?.href ||
        `${DEVOPS_BASE_URL}/${fields['System.TeamProject']}/_workitems/edit/${wi.id}`,
      tags:
        fields['System.Tags']
          ?.split(';')
          .map((t: string) => t.trim())
          .filter(Boolean) || [],
      priority: mapPriority(fields['Microsoft.VSTS.Common.Priority']),
    };
  }

  // Helper: Map DevOps work item to WorkItem
  private mapToWorkItem(wi: DevOpsWorkItem, parentId?: number): WorkItem {
    const fields = wi.fields;
    return {
      id: wi.id,
      title: fields['System.Title'],
      description: fields['System.Description'] || '',
      state: fields['System.State'],
      workItemType: fields['System.WorkItemType'],
      parentId,
      areaPath: fields['System.AreaPath'],
      project: fields['System.TeamProject'],
      createdAt: new Date(fields['System.CreatedDate']),
      updatedAt: new Date(fields['System.ChangedDate']),
      completedWork: (fields['Microsoft.VSTS.Scheduling.CompletedWork'] as number) || 0,
      remainingWork: (fields['Microsoft.VSTS.Scheduling.RemainingWork'] as number) || 0,
      originalEstimate: (fields['Microsoft.VSTS.Scheduling.OriginalEstimate'] as number) || 0,
      assignee: identityToUser(fields['System.AssignedTo']),
      devOpsUrl:
        wi._links?.html?.href ||
        `${DEVOPS_BASE_URL}/${fields['System.TeamProject']}/_workitems/edit/${wi.id}`,
      tags:
        fields['System.Tags']
          ?.split(';')
          .map((t: string) => t.trim())
          .filter(Boolean) || [],
      priority: mapPriority(fields['Microsoft.VSTS.Common.Priority']),
    };
  }

  // Git API Methods

  // Get all repositories in a project
  async getRepositories(projectName: string): Promise<{ id: string; name: string }[]> {
    const response = await fetch(
      `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/git/repositories?api-version=7.0`,
      { headers: this.headers }
    );

    if (!response.ok) {
      console.error(`Failed to fetch repositories for ${projectName}:`, response.statusText);
      return [];
    }

    const data = await response.json();
    return (
      data.value?.map((repo: { id: string; name: string }) => ({
        id: repo.id,
        name: repo.name,
      })) || []
    );
  }

  // Get commits from a repository within a date range
  // Note: Returns up to 1000 commits per repo. For very active repos over a 365-day period,
  // pagination via continuation tokens could be added if needed.
  async getCommits(
    projectName: string,
    repositoryId: string,
    fromDate?: Date,
    toDate?: Date
  ): Promise<{ date: string; authorId: string; authorName: string; authorEmail: string }[]> {
    const url = new URL(
      `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/git/repositories/${repositoryId}/commits`
    );
    url.searchParams.set('api-version', '7.0');
    url.searchParams.set('$top', '1000');

    if (fromDate) {
      url.searchParams.set('searchCriteria.fromDate', fromDate.toISOString());
    }
    if (toDate) {
      url.searchParams.set('searchCriteria.toDate', toDate.toISOString());
    }

    const response = await fetch(url.toString(), { headers: this.headers });

    if (!response.ok) {
      console.error(`Failed to fetch commits:`, response.statusText);
      return [];
    }

    const data = await response.json();
    return (
      data.value?.map(
        (commit: {
          author: { date: string; name: string; email: string };
          committer: { date: string };
        }) => ({
          date: commit.author.date.split('T')[0],
          authorId: commit.author.email,
          authorName: commit.author.name,
          authorEmail: commit.author.email,
        })
      ) || []
    );
  }

  // Get pull requests from a project within a date range
  // Note: Returns up to 500 PRs per project. For orgs with very high PR volume,
  // pagination via continuation tokens could be added if needed.
  async getPullRequests(
    projectName: string,
    fromDate?: Date,
    toDate?: Date
  ): Promise<{ date: string; authorId: string; authorName: string; status: string }[]> {
    const url = new URL(
      `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/git/pullrequests`
    );
    url.searchParams.set('api-version', '7.0');
    url.searchParams.set('searchCriteria.status', 'all');
    url.searchParams.set('$top', '500');

    if (fromDate) {
      url.searchParams.set('searchCriteria.minTime', fromDate.toISOString());
    }
    if (toDate) {
      url.searchParams.set('searchCriteria.maxTime', toDate.toISOString());
    }

    const response = await fetch(url.toString(), { headers: this.headers });

    if (!response.ok) {
      console.error(`Failed to fetch pull requests:`, response.statusText);
      return [];
    }

    const data = await response.json();
    const prs = data.value || [];

    return prs.map(
      (pr: {
        creationDate: string;
        createdBy: { id: string; displayName: string };
        status: string;
      }) => ({
        date: pr.creationDate.split('T')[0],
        authorId: pr.createdBy.id,
        authorName: pr.createdBy.displayName,
        status: pr.status,
      })
    );
  }

  // Get all Git activity (commits + PRs) across all projects
  // Uses sequential project processing to avoid overwhelming the Azure DevOps API
  async getGitActivity(
    fromDate?: Date,
    toDate?: Date
  ): Promise<{
    commits: { date: string; count: number }[];
    pullRequests: { date: string; count: number }[];
  }> {
    const projects = await this.getProjects();
    const commitsByDate = new Map<string, number>();
    const prsByDate = new Map<string, number>();

    // Process projects sequentially to limit concurrent API requests
    const projectActivities = await Promise.allSettled(
      projects.map(async (project) => {
        // Get repositories
        const repos = await this.getRepositories(project.name);

        // Process repos in batches of 5 to limit concurrency
        for (let i = 0; i < repos.length; i += 5) {
          const batch = repos.slice(i, i + 5);
          const commitResults = await Promise.allSettled(
            batch.map((repo) => this.getCommits(project.name, repo.id, fromDate, toDate))
          );

          for (const result of commitResults) {
            if (result.status === 'fulfilled') {
              for (const commit of result.value) {
                commitsByDate.set(commit.date, (commitsByDate.get(commit.date) || 0) + 1);
              }
            }
          }
        }

        // Get PRs
        const prs = await this.getPullRequests(project.name, fromDate, toDate);
        for (const pr of prs) {
          prsByDate.set(pr.date, (prsByDate.get(pr.date) || 0) + 1);
        }
      })
    );

    // Log any failures
    for (let i = 0; i < projectActivities.length; i++) {
      if (projectActivities[i].status === 'rejected') {
        console.error(
          `Failed to fetch Git activity for ${projects[i].name}:`,
          (projectActivities[i] as PromiseRejectedResult).reason
        );
      }
    }

    return {
      commits: Array.from(commitsByDate.entries()).map(([date, count]) => ({ date, count })),
      pullRequests: Array.from(prsByDate.entries()).map(([date, count]) => ({ date, count })),
    };
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
