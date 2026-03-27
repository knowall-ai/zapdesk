// Azure DevOps API Service Layer

/** Escape single quotes in WIQL string literals to prevent injection */
function escapeWiql(value: string): string {
  return value.replace(/'/g, "''");
}
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
  Attachment,
  Epic,
  Feature,
  WorkItem,
  WorkItemUpdate,
  EpicType,
  TreemapNode,
  ClassificationNode,
} from '@/types';
import { parseSLAFromDescription, calculateTicketSLA, DEFAULT_SLA_LEVEL } from './sla';

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

// Cache for project list per organization (avoids redundant fetches)
const projectListCache: Map<string, { data: DevOpsProject[]; timestamp: number }> = new Map();
const PROJECT_CACHE_TTL_MS = 30 * 1000; // 30 seconds

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

// All effort estimate fields on Features (all stored in days in Azure DevOps)
const FEATURE_EFFORT_FIELDS = [
  'Microsoft.VSTS.Scheduling.Effort',
  'Custom.StrategicEffortDays',
  'Custom.PrepEffortDays',
  'Custom.DesignEffortDays',
  'Custom.Engineereffort',
  'Custom.TestEffortDays',
  'Custom.PlanningEffortDays',
  'Custom.OperateEffortDays',
  'Custom.Architecteffort',
  'Custom.Managereffort',
];

// Sum all effort fields and convert from days to hours (8h/day)
function sumEffortFields(fields: Record<string, unknown>): number | undefined {
  let total = 0;
  let hasValue = false;
  for (const field of FEATURE_EFFORT_FIELDS) {
    const raw = fields[field];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      total += raw;
      hasValue = true;
    }
  }
  return hasValue ? total * 8 : undefined;
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
// Uses avatar API as fallback when imageUrl is not provided
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
    // Use imageUrl if available, otherwise fall back to avatar API
    avatarUrl: identity.imageUrl || `/api/devops/avatar/${identity.id}`,
  };
}

// Convert DevOps identity to Customer
// Uses avatar API as fallback when imageUrl is not provided
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
    // Use imageUrl if available, otherwise fall back to avatar API
    avatarUrl: identity.imageUrl || `/api/devops/avatar/${identity.id}`,
    lastUpdated: new Date(),
  };
}

// Convert Ticket to WorkItem (for WorkItemBoard compatibility)
export function ticketToWorkItem(ticket: Ticket): WorkItem {
  return {
    id: ticket.id,
    title: ticket.title,
    description: ticket.description,
    state: ticket.devOpsState,
    workItemType: ticket.workItemType,
    areaPath: '',
    project: ticket.project,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    completedWork: 0,
    remainingWork: 0,
    originalEstimate: 0,
    assignee: ticket.assignee,
    devOpsUrl: ticket.devOpsUrl,
    tags: ticket.tags,
    priority: ticket.priority,
    requester: ticket.requester,
    organization: ticket.organization,
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
    reproSteps: (fields['Microsoft.VSTS.TCM.ReproSteps'] as string) || undefined,
    systemInfo: (fields['Microsoft.VSTS.TCM.SystemInfo'] as string) || undefined,
    resolution: (fields['Microsoft.VSTS.Common.Resolution'] as string) || undefined,
    resolvedReason: (fields['Microsoft.VSTS.Common.ResolvedReason'] as string) || undefined,
    status: mapStateToStatus(fields['System.State']),
    devOpsState: fields['System.State'], // Preserve original DevOps state
    workItemType: fields['System.WorkItemType'], // Azure DevOps work item type
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

  // Get all projects the user has access to (cached for 30s per org)
  async getProjects(): Promise<DevOpsProject[]> {
    const cached = projectListCache.get(this.organization);
    if (cached && Date.now() - cached.timestamp < PROJECT_CACHE_TTL_MS) {
      return cached.data;
    }

    const response = await fetch(`${this.baseUrl}/_apis/projects?api-version=7.0`, {
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch projects: ${response.statusText}`);
    }

    const data = await response.json();
    const projects: DevOpsProject[] = data.value;
    projectListCache.set(this.organization, { data: projects, timestamp: Date.now() });
    return projects;
  }

  // Get the process template name for a project
  async getProjectProcessTemplate(projectName: string): Promise<string | null> {
    try {
      // First get available processes to build a map of process IDs to names
      const processesResponse = await fetch(
        `${this.baseUrl}/_apis/work/processes?api-version=7.1-preview.2`,
        { headers: this.headers }
      );

      const processMap = new Map<string, string>();
      if (processesResponse.ok) {
        const processesData = await processesResponse.json();
        for (const process of processesData.value || []) {
          if (process.typeId && process.name) {
            processMap.set(process.typeId, process.name);
          }
        }
      }

      // Get project properties which includes process template info
      const propsResponse = await fetch(
        `${this.baseUrl}/_apis/projects/${encodeURIComponent(projectName)}/properties?api-version=7.1-preview.1`,
        { headers: this.headers }
      );

      if (!propsResponse.ok) {
        return null;
      }

      const propsData = await propsResponse.json();
      const properties = propsData.value || [];

      // Get the ProcessTemplateType
      const processTemplateTypeProp = properties.find(
        (p: { name: string; value: string }) => p.name === 'System.ProcessTemplateType'
      );

      if (processTemplateTypeProp?.value) {
        const templateName = processMap.get(processTemplateTypeProp.value);
        if (templateName) return templateName;
      }

      // Fallback to CurrentProcessTemplateId
      const currentProcessIdProp = properties.find(
        (p: { name: string; value: string }) => p.name === 'System.CurrentProcessTemplateId'
      );
      if (currentProcessIdProp?.value) {
        const templateName = processMap.get(currentProcessIdProp.value);
        if (templateName) return templateName;
      }

      // Final fallback to System.Process Template name
      const templateNameProp = properties.find(
        (p: { name: string; value: string }) => p.name === 'System.Process Template'
      );
      return templateNameProp?.value || null;
    } catch (error) {
      console.error(`Failed to get process template for project ${projectName}:`, error);
      return null;
    }
  }

  // Get state definitions for a work item type (name, color, category from DevOps)
  async getWorkItemTypeStates(
    projectName: string,
    typeName: string
  ): Promise<{ name: string; color: string; category: string }[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitemtypes/${encodeURIComponent(typeName)}/states?api-version=7.0`,
        { headers: this.headers }
      );
      if (!response.ok) return [];
      const data = await response.json();
      return (data.value || []).map((s: { name: string; color: string; category: string }) => ({
        name: s.name,
        color: s.color,
        category: s.category,
      }));
    } catch {
      return [];
    }
  }

  // Get work items from a specific project
  // By default, filters to work items with "ticket" tag
  // Set ticketsOnly=false to get all work items regardless of tags
  async getTickets(
    projectName: string,
    options?: {
      additionalFilters?: string;
      ticketsOnly?: boolean;
      allowedTypes?: string[];
    }
  ): Promise<DevOpsWorkItem[]> {
    const { additionalFilters, ticketsOnly = true, allowedTypes } = options || {};

    // WIQL query - optionally filter by "ticket" tag
    const ticketTagClause = ticketsOnly ? "AND [System.Tags] CONTAINS 'ticket'" : '';
    // Optionally restrict to specific work item types (e.g., exclude Epic, Feature, User Story)
    const typeClause = allowedTypes?.length
      ? `AND [System.WorkItemType] IN (${allowedTypes.map((t) => `'${escapeWiql(t)}'`).join(', ')})`
      : '';
    const wiql = {
      query: `
        SELECT [System.Id], [System.Title], [System.State], [System.CreatedDate],
               [System.ChangedDate], [System.CreatedBy], [System.AssignedTo],
               [System.Tags], [Microsoft.VSTS.Common.Priority], [System.Description],
               [System.WorkItemType], [System.AreaPath], [System.TeamProject]
        FROM WorkItems
        WHERE [System.TeamProject] = '${escapeWiql(projectName)}'
          ${ticketTagClause}
          ${typeClause}
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
      const fields = [
        'System.Title',
        'System.Description',
        'System.State',
        'System.CreatedDate',
        'System.ChangedDate',
        'System.CreatedBy',
        'System.AssignedTo',
        'System.Tags',
        'Microsoft.VSTS.Common.Priority',
        'System.TeamProject',
        'System.WorkItemType',
        'System.AreaPath',
        'Microsoft.VSTS.Common.ResolvedReason',
        'Microsoft.VSTS.Common.Resolution',
        'Microsoft.VSTS.TCM.ReproSteps',
        'Microsoft.VSTS.TCM.SystemInfo',
      ].join(',');
      const workItemsResponse = await fetch(
        `${this.baseUrl}/_apis/wit/workitems?ids=${batch.join(',')}&fields=${fields}&api-version=7.0`,
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

  // Get work item update history (revisions with field changes)
  async getWorkItemUpdates(projectName: string, workItemId: number): Promise<WorkItemUpdate[]> {
    const response = await fetch(
      `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitems/${workItemId}/updates?api-version=7.0`,
      { headers: this.headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch work item updates: ${response.statusText}`);
    }

    const data = await response.json();

    // Fields we care about for the history view
    const trackedFields = new Set([
      'System.State',
      'System.AssignedTo',
      'System.Title',
      'Microsoft.VSTS.Common.Priority',
      'System.Tags',
      'System.AreaPath',
    ]);

    return (data.value || [])
      .filter(
        (update: {
          id: number;
          fields?: Record<string, { oldValue?: unknown; newValue?: unknown }>;
        }) => {
          // Skip revision 1 (creation) unless it has meaningful tracked fields
          if (update.id === 1) return true;
          if (!update.fields) return false;
          // Only include updates that changed tracked fields
          return Object.keys(update.fields).some((key) => trackedFields.has(key));
        }
      )
      .map(
        (update: {
          id: number;
          rev: number;
          revisedBy: {
            displayName: string;
            uniqueName: string;
            id: string;
            imageUrl?: string;
          };
          revisedDate: string;
          fields?: Record<string, { oldValue?: unknown; newValue?: unknown }>;
        }) => {
          // Filter fields to only tracked ones and normalize identity values
          const fields: Record<string, { oldValue?: string; newValue?: string }> = {};
          if (update.fields) {
            for (const [key, value] of Object.entries(update.fields)) {
              if (trackedFields.has(key)) {
                const normalize = (v: unknown): string | undefined => {
                  if (v == null) return undefined;
                  if (typeof v === 'object' && v !== null && 'displayName' in v) {
                    return (v as { displayName: string }).displayName;
                  }
                  return String(v);
                };
                fields[key] = {
                  oldValue: normalize(value.oldValue),
                  newValue: normalize(value.newValue),
                };
              }
            }
          }

          return {
            id: update.id,
            rev: update.rev,
            revisedBy: {
              id: update.revisedBy.id,
              displayName: update.revisedBy.displayName,
              email: update.revisedBy.uniqueName,
              avatarUrl: update.revisedBy.imageUrl,
            },
            revisedDate: update.revisedDate,
            fields,
          };
        }
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

    const createUrl = `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitems/$${workItemType}?api-version=7.0`;
    const createHeaders = {
      ...this.headers,
      'Content-Type': 'application/json-patch+json',
    };

    const response = await fetch(createUrl, {
      method: 'POST',
      headers: createHeaders,
      body: JSON.stringify(patchDocument),
    });

    if (!response.ok) {
      const errorText = await response.text();

      // Handle required field validation errors by fetching defaults and retrying
      const retryDoc = await this.resolveRequiredFieldErrors(
        errorText,
        patchDocument,
        projectName,
        workItemType
      );
      if (retryDoc) {
        const retryResponse = await fetch(createUrl, {
          method: 'POST',
          headers: createHeaders,
          body: JSON.stringify(retryDoc),
        });
        if (retryResponse.ok) {
          return retryResponse.json();
        }
        const retryError = await retryResponse.text();
        throw new Error(`Failed to create work item: ${retryResponse.statusText} - ${retryError}`);
      }

      throw new Error(`Failed to create work item: ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  // Get classification nodes (iterations or areas) for a project
  private async getClassificationNodes(
    projectName: string,
    structureType: 'iterations' | 'areas',
    depth: number = 10
  ): Promise<ClassificationNode[]> {
    const response = await fetch(
      `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/classificationnodes/${structureType}?$depth=${depth}&api-version=7.0`,
      { headers: this.headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch ${structureType}: ${response.statusText}`);
    }

    const data = await response.json();
    return this.flattenClassificationNodes(
      data,
      structureType === 'iterations' ? 'iteration' : 'area'
    );
  }

  // Flatten nested classification nodes into a flat list with full paths
  private flattenClassificationNodes(
    node: {
      id: number;
      name: string;
      hasChildren: boolean;
      children?: Array<{
        id: number;
        name: string;
        hasChildren: boolean;
        children?: unknown[];
        path?: string;
      }>;
      path?: string;
    },
    structureType: 'area' | 'iteration',
    parentPath: string = ''
  ): ClassificationNode[] {
    const currentPath = parentPath ? `${parentPath}\\${node.name}` : node.name;
    const result: ClassificationNode[] = [
      {
        id: node.id,
        name: node.name,
        structureType,
        hasChildren: node.hasChildren,
        path: currentPath,
      },
    ];

    if (node.children) {
      for (const child of node.children) {
        result.push(
          ...this.flattenClassificationNodes(
            child as {
              id: number;
              name: string;
              hasChildren: boolean;
              children?: Array<{
                id: number;
                name: string;
                hasChildren: boolean;
                children?: unknown[];
                path?: string;
              }>;
              path?: string;
            },
            structureType,
            currentPath
          )
        );
      }
    }

    return result;
  }

  // Get all iterations for a project (flat list with paths)
  async getIterations(projectName: string): Promise<ClassificationNode[]> {
    return this.getClassificationNodes(projectName, 'iterations');
  }

  // Get all areas for a project (flat list with paths)
  async getAreas(projectName: string): Promise<ClassificationNode[]> {
    return this.getClassificationNodes(projectName, 'areas');
  }

  // Create a new work item (ticket) with assignee and custom tags
  async createTicketWithAssignee(
    projectName: string,
    title: string,
    description: string,
    options: {
      priority?: number | string;
      tags?: string[];
      assigneeId?: string;
      workItemType?: string;
      hasPriority?: boolean;
      priorityFieldRef?: string;
      additionalFields?: Record<string, string | number>;
      iterationPath?: string;
      areaPath?: string;
    } = {}
  ): Promise<DevOpsWorkItem> {
    const {
      priority,
      tags = ['ticket'],
      assigneeId,
      workItemType = 'Task',
      hasPriority = true,
      priorityFieldRef,
      additionalFields,
      iterationPath,
      areaPath,
    } = options;
    const patchDocument: Array<{ op: string; path: string; value: string | number }> = [
      { op: 'add', path: '/fields/System.Title', value: title },
      { op: 'add', path: '/fields/System.Description', value: description },
      { op: 'add', path: '/fields/System.Tags', value: tags.join('; ') },
    ];

    // Only add Priority if the template supports it and a value was provided
    if (hasPriority && priority != null && priority !== '') {
      const fieldPath = priorityFieldRef || 'Microsoft.VSTS.Common.Priority';
      patchDocument.push({
        op: 'add',
        path: `/fields/${fieldPath}`,
        value: priority,
      });
    }

    if (assigneeId) {
      patchDocument.push({ op: 'add', path: '/fields/System.AssignedTo', value: assigneeId });
    }

    if (iterationPath) {
      patchDocument.push({ op: 'add', path: '/fields/System.IterationPath', value: iterationPath });
    }

    if (areaPath) {
      patchDocument.push({ op: 'add', path: '/fields/System.AreaPath', value: areaPath });
    }

    // Append any additional required fields, excluding fields already set above
    const reservedFields = new Set([
      'System.Title',
      'System.Description',
      'System.Tags',
      'System.AssignedTo',
    ]);
    if (additionalFields) {
      for (const [key, value] of Object.entries(additionalFields)) {
        if (value != null && value !== '' && !reservedFields.has(key)) {
          patchDocument.push({ op: 'add', path: `/fields/${key}`, value });
        }
      }
    }

    const createUrl = `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitems/$${workItemType}?api-version=7.0`;
    const createHeaders = {
      ...this.headers,
      'Content-Type': 'application/json-patch+json',
    };

    const response = await fetch(createUrl, {
      method: 'POST',
      headers: createHeaders,
      body: JSON.stringify(patchDocument),
    });

    if (!response.ok) {
      const errorText = await response.text();

      // Handle required field validation errors by fetching defaults and retrying
      const retryDoc = await this.resolveRequiredFieldErrors(
        errorText,
        patchDocument,
        projectName,
        workItemType
      );
      if (retryDoc) {
        const retryResponse = await fetch(createUrl, {
          method: 'POST',
          headers: createHeaders,
          body: JSON.stringify(retryDoc),
        });
        if (retryResponse.ok) {
          return retryResponse.json();
        }
        const retryError = await retryResponse.text();
        throw new Error(`Failed to create work item: ${retryResponse.statusText} - ${retryError}`);
      }

      throw new Error(`Failed to create work item: ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Parse RuleValidationException errors, fetch allowed values for required fields,
   * and return an updated patch document with defaults. Returns null if not applicable.
   */
  private async resolveRequiredFieldErrors(
    errorText: string,
    patchDocument: Array<{ op: string; path: string; value: string | number }>,
    projectName: string,
    workItemType: string
  ): Promise<Array<{ op: string; path: string; value: string | number }> | null> {
    try {
      const errorData = JSON.parse(errorText);
      const ruleErrors = errorData?.customProperties?.RuleValidationErrors;
      if (!ruleErrors || !Array.isArray(ruleErrors) || ruleErrors.length === 0) {
        return null;
      }

      const existingFields = new Set(patchDocument.map((d) => d.path));
      const retryDoc = [...patchDocument];
      let addedFields = 0;

      // Only auto-fill fields with constrained value lists (e.g., Severity, Priority).
      // Skip identity/people fields — those require user input via the UI.
      const IDENTITY_FIELD_PREFIXES = ['Custom.FoundBy', 'System.AssignedTo', 'System.CreatedBy'];

      for (const ruleError of ruleErrors) {
        const fieldRef: string = ruleError.fieldReferenceName;
        if (!fieldRef || existingFields.has(`/fields/${fieldRef}`)) continue;

        // Never auto-fill identity fields — they need explicit user selection
        if (IDENTITY_FIELD_PREFIXES.some((p) => fieldRef.startsWith(p))) {
          console.warn(`Skipping auto-fill for identity field ${fieldRef} — requires user input`);
          continue;
        }

        try {
          const fieldUrl = `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitemtypes/${encodeURIComponent(workItemType)}/fields/${encodeURIComponent(fieldRef)}?$expand=allowedValues&api-version=7.1`;
          const fieldResponse = await fetch(fieldUrl, { headers: this.headers });
          if (fieldResponse.ok) {
            const fieldData = await fieldResponse.json();
            const allowedValues: string[] = fieldData.allowedValues || [];
            // Only auto-fill if the field has a small, constrained set of values
            if (allowedValues.length > 0 && allowedValues.length <= 20) {
              retryDoc.push({
                op: 'add',
                path: `/fields/${fieldRef}`,
                value: allowedValues[0],
              });
              addedFields++;
              console.log(
                `Auto-filling required field ${fieldRef}: "${allowedValues[0]}" (${allowedValues.length} options)`
              );
            } else if (allowedValues.length > 20) {
              console.warn(
                `Skipping auto-fill for ${fieldRef} — too many options (${allowedValues.length}), requires user input`
              );
            }
          }
        } catch (fieldErr) {
          console.warn(`Could not fetch allowed values for ${fieldRef}:`, fieldErr);
        }
      }

      return addedFields > 0 ? retryDoc : null;
    } catch {
      return null;
    }
  }

  // Get field info for a work item type (including allowed values and whether it's required)
  async getWorkItemTypeField(
    projectName: string,
    workItemType: string,
    fieldRef: string
  ): Promise<{ required: boolean; allowedValues: string[]; name: string }> {
    const url = `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitemtypes/${encodeURIComponent(workItemType)}/fields/${encodeURIComponent(fieldRef)}?$expand=allowedValues&api-version=7.1`;
    const response = await fetch(url, { headers: this.headers });

    if (!response.ok) {
      throw new Error(`Failed to fetch field info: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      required: data.alwaysRequired || false,
      allowedValues: data.allowedValues || [],
      name: data.name || fieldRef,
    };
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

  // Change work item type (e.g., Task → Bug)
  // Azure DevOps supports this via PATCH with System.WorkItemType in the JSON patch body
  async changeWorkItemType(
    projectName: string,
    workItemId: number,
    newType: string,
    additionalFields?: Record<string, string | number>
  ): Promise<DevOpsWorkItem> {
    // First, get the current work item to read its current state
    const currentItem = await this.getWorkItem(projectName, workItemId);
    const currentState = currentItem.fields['System.State'];

    // Get valid states for the target work item type
    let targetState = currentState;
    try {
      const statesUrl = `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitemtypes/${encodeURIComponent(newType)}/states?api-version=7.1`;
      const statesResponse = await fetch(statesUrl, { headers: this.headers });
      if (statesResponse.ok) {
        const statesData = await statesResponse.json();
        const validStates: { name: string; category: string }[] = statesData.value;
        const validStateNames = validStates.map((s) => s.name);

        if (!validStateNames.includes(currentState)) {
          // Try to find a state in the same category as the current state
          const currentTypeStatesUrl = `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitemtypes/${encodeURIComponent(currentItem.fields['System.WorkItemType'])}/states?api-version=7.1`;
          const currentStatesResponse = await fetch(currentTypeStatesUrl, {
            headers: this.headers,
          });
          let currentCategory = 'Proposed';
          if (currentStatesResponse.ok) {
            const currentStatesData = await currentStatesResponse.json();
            const currentStateInfo = currentStatesData.value.find(
              (s: { name: string }) => s.name === currentState
            );
            if (currentStateInfo) {
              currentCategory = currentStateInfo.category;
            }
          }

          // Find a matching state by category, or fall back to first state
          const matchByCategory = validStates.find((s) => s.category === currentCategory);
          targetState = matchByCategory ? matchByCategory.name : validStates[0]?.name || 'New';
        }

        console.log(
          `Type change: ${currentItem.fields['System.WorkItemType']} → ${newType}, state: ${currentState} → ${targetState}, valid states: [${validStateNames.join(', ')}]`
        );
      } else {
        console.warn('Failed to fetch states for target type:', statesResponse.status);
      }
    } catch (err) {
      console.warn('Could not fetch valid states for target type, keeping current state:', err);
    }

    // Per Microsoft docs: use org-level URL (no project), set both WorkItemType and State
    // See: https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/update
    const patchDoc: Array<{ op: string; path: string; value: string | number }> = [
      {
        op: 'add',
        path: '/fields/System.WorkItemType',
        value: newType,
      },
      {
        op: 'add',
        path: '/fields/System.State',
        value: targetState,
      },
    ];

    // Add any additional fields (e.g. Severity, Found By for Enhancement type)
    if (additionalFields) {
      for (const [fieldRef, value] of Object.entries(additionalFields)) {
        patchDoc.push({
          op: 'add',
          path: `/fields/${fieldRef}`,
          value,
        });
      }
    }

    console.log(`Changing work item ${workItemId} type to ${newType} with state ${targetState}`);

    const url = `${this.baseUrl}/_apis/wit/workitems/${workItemId}?api-version=7.1`;
    const patchHeaders = {
      ...this.headers,
      'Content-Type': 'application/json-patch+json',
    };

    const response = await fetch(url, {
      method: 'PATCH',
      headers: patchHeaders,
      body: JSON.stringify(patchDoc),
    });

    if (!response.ok) {
      const errorText = await response.text();

      // Check for required field validation errors and retry with defaults
      try {
        const errorData = JSON.parse(errorText);
        const ruleErrors = errorData?.customProperties?.RuleValidationErrors;
        if (ruleErrors && Array.isArray(ruleErrors) && ruleErrors.length > 0) {
          console.log('Type change has required field errors, fetching defaults...');
          const retryPatchDoc = [...patchDoc];

          for (const ruleError of ruleErrors) {
            const fieldRef: string = ruleError.fieldReferenceName;
            if (!fieldRef) continue;

            // Skip fields we already set
            if (fieldRef === 'System.WorkItemType' || fieldRef === 'System.State') continue;

            // Fetch allowed values for this field
            try {
              const fieldUrl = `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitemtypes/${encodeURIComponent(newType)}/fields/${encodeURIComponent(fieldRef)}?$expand=allowedValues&api-version=7.1`;
              const fieldResponse = await fetch(fieldUrl, {
                headers: this.headers,
              });
              if (fieldResponse.ok) {
                const fieldData = await fieldResponse.json();
                const allowedValues: string[] = fieldData.allowedValues || [];
                if (allowedValues.length > 0) {
                  // Use the first allowed value as default
                  retryPatchDoc.push({
                    op: 'add',
                    path: `/fields/${fieldRef}`,
                    value: allowedValues[0],
                  });
                  console.log(
                    `Setting default for ${fieldRef}: "${allowedValues[0]}" (from ${allowedValues.length} options)`
                  );
                }
              }
            } catch (fieldErr) {
              console.warn(`Could not fetch allowed values for ${fieldRef}:`, fieldErr);
            }
          }

          // Retry with defaults for required fields
          if (retryPatchDoc.length > patchDoc.length) {
            console.log('Retrying type change with required field defaults...');
            const retryResponse = await fetch(url, {
              method: 'PATCH',
              headers: patchHeaders,
              body: JSON.stringify(retryPatchDoc),
            });

            if (retryResponse.ok) {
              return retryResponse.json();
            }

            const retryError = await retryResponse.text();
            console.error('Retry also failed:', retryResponse.status, retryError);
            throw new Error(
              `Failed to change work item type: ${retryResponse.statusText} - ${retryError}`
            );
          }
        }
      } catch (parseErr) {
        // If error isn't JSON or retry logic fails, fall through to original error
        if (parseErr instanceof Error && parseErr.message.startsWith('Failed to change')) {
          throw parseErr;
        }
      }

      console.error('Change type API response:', response.status, errorText);
      throw new Error(`Failed to change work item type: ${response.statusText} - ${errorText}`);
    }

    return response.json();
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

  // Update work item fields (assignee, priority, title, description)
  async updateTicketFields(
    projectName: string,
    workItemId: number,
    updates: {
      assignee?: string | null;
      priority?: number;
      title?: string;
      description?: string;
      tags?: string[];
    }
  ): Promise<DevOpsWorkItem> {
    const patchDocument: Array<{ op: string; path: string; value: string | number | null }> = [];

    if (updates.tags !== undefined) {
      patchDocument.push({
        op: 'replace',
        path: '/fields/System.Tags',
        value: updates.tags.join('; '),
      });
    }

    if (updates.title !== undefined) {
      patchDocument.push({
        op: 'add',
        path: '/fields/System.Title',
        value: updates.title,
      });
    }

    if (updates.description !== undefined) {
      patchDocument.push({
        op: 'add',
        path: '/fields/System.Description',
        value: updates.description,
      });
    }

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

  // Upload an attachment to Azure DevOps
  async uploadAttachment(
    projectName: string,
    fileName: string,
    fileContent: ArrayBuffer,
    contentType: string
  ): Promise<{ id: string; url: string }> {
    const encodedFileName = encodeURIComponent(fileName);
    const response = await fetch(
      `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/attachments?fileName=${encodedFileName}&api-version=7.0`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/octet-stream',
        },
        body: fileContent,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to upload attachment: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    return { id: data.id, url: data.url };
  }

  // Link an uploaded attachment to a work item
  async linkAttachmentToWorkItem(
    projectName: string,
    workItemId: number,
    attachmentUrl: string,
    fileName: string,
    comment?: string
  ): Promise<void> {
    const patchDocument = [
      {
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'AttachedFile',
          url: attachmentUrl,
          attributes: {
            comment: comment || fileName,
          },
        },
      },
    ];

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
      throw new Error(`Failed to link attachment: ${response.statusText} - ${errorText}`);
    }
  }

  // Upload and link an attachment to a work item in one operation
  async addAttachmentToWorkItem(
    projectName: string,
    workItemId: number,
    fileName: string,
    fileContent: ArrayBuffer,
    contentType: string,
    comment?: string
  ): Promise<{ id: string; url: string }> {
    // Step 1: Upload the attachment
    const uploadResult = await this.uploadAttachment(
      projectName,
      fileName,
      fileContent,
      contentType
    );

    // Step 2: Link it to the work item
    await this.linkAttachmentToWorkItem(
      projectName,
      workItemId,
      uploadResult.url,
      fileName,
      comment
    );

    return uploadResult;
  }

  // Get attachments for a work item
  async getWorkItemAttachments(projectName: string, workItemId: number): Promise<Attachment[]> {
    const response = await fetch(
      `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitems/${workItemId}?$expand=relations&api-version=7.0`,
      { headers: this.headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch work item relations: ${response.statusText}`);
    }

    const workItem = await response.json();
    const attachments: Attachment[] = [];

    // Filter relations for AttachedFile type
    for (const relation of workItem.relations || []) {
      if (relation.rel === 'AttachedFile') {
        // Extract attachment ID from URL
        const attachmentUrl = relation.url;
        const idMatch = attachmentUrl.match(/attachments\/([a-f0-9-]+)/i);
        const id = idMatch ? idMatch[1] : attachmentUrl;

        // Parse filename from attributes or URL
        const fileName =
          relation.attributes?.name ||
          relation.attributes?.comment ||
          attachmentUrl.split('/').pop()?.split('?')[0] ||
          'attachment';

        attachments.push({
          id,
          fileName,
          url: attachmentUrl,
          contentType: relation.attributes?.contentType || 'application/octet-stream',
          size: relation.attributes?.length || 0,
          createdAt: new Date(relation.attributes?.resourceCreatedDate || Date.now()),
        });
      }
    }

    return attachments;
  }

  /**
   * Find which project a work item belongs to by checking all accessible projects.
   * Returns the project and the work item, or null if not found.
   */
  async findProjectForWorkItem(
    workItemId: number
  ): Promise<{ project: DevOpsProject; workItem: DevOpsWorkItem } | null> {
    const projects = await this.getProjects();

    for (const project of projects) {
      try {
        const workItem = await this.getWorkItem(project.name, workItemId);
        if (workItem) {
          return { project, workItem };
        }
      } catch {
        // Work item not in this project, continue
        continue;
      }
    }

    return null;
  }

  // Get all tickets from all accessible projects (fetches in parallel)
  // Set ticketsOnly=false to get all work items (not just those tagged as "ticket")
  async getAllTickets(ticketsOnly: boolean = true, allowedTypes?: string[]): Promise<Ticket[]> {
    const projects = await this.getProjects();
    const slaMap = await getProjectSLAMap();

    const results = await Promise.allSettled(
      projects.map(async (project) => {
        const workItems = await this.getTickets(project.name, {
          ticketsOnly,
          allowedTypes,
        });
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
        return workItems.map((wi) => {
          const ticket = workItemToTicket(wi, organization);

          // Populate SLA-relevant timestamps from work item fields
          const fields = wi.fields || {};

          // Populate resolvedAt from known resolved date fields
          if (!ticket.resolvedAt) {
            const resolvedFieldNames = [
              'Microsoft.VSTS.Common.ResolvedDate',
              'Custom.ResolvedDate',
              'System.ResolvedDate',
            ];
            for (const fieldName of resolvedFieldNames) {
              const value = fields[fieldName as keyof typeof fields];
              if (value) {
                const resolvedDate = new Date(value as string);
                if (!isNaN(resolvedDate.getTime())) {
                  ticket.resolvedAt = resolvedDate;
                  break;
                }
              }
            }
          }

          // Populate firstResponseAt from known first-response date fields
          if (!ticket.firstResponseAt) {
            const firstResponseFieldNames = [
              'Custom.FirstResponseDate',
              'Microsoft.VSTS.Common.FirstResponseDate',
            ];
            for (const fieldName of firstResponseFieldNames) {
              const value = fields[fieldName as keyof typeof fields];
              if (value) {
                const firstResponseDate = new Date(value as string);
                if (!isNaN(firstResponseDate.getTime())) {
                  ticket.firstResponseAt = firstResponseDate;
                  break;
                }
              }
            }
          }

          // Calculate SLA info for the ticket using the populated timestamps
          ticket.slaInfo = calculateTicketSLA(ticket, slaLevel);
          return ticket;
        });
      })
    );

    const allTickets: Ticket[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        allTickets.push(...result.value);
      } else {
        console.error(`Failed to fetch tickets from ${projects[i].name}:`, result.reason);
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
        WHERE [System.TeamProject] = '${escapeWiql(projectName)}'
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
      .map((wi: DevOpsWorkItem) => this.mapToFeature(wi, epicId))
      .sort((a: Feature, b: Feature) => a.id - b.id);
  }

  // Get Tasks under a Feature (handles both direct Tasks and Tasks under User Stories)
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

    // Fetch direct children with relations (could be User Stories or Tasks)
    const workItemsResponse = await fetch(
      `${this.baseUrl}/_apis/wit/workitems?ids=${childIds.join(',')}&$expand=relations&api-version=7.0`,
      { headers: this.headers }
    );

    if (!workItemsResponse.ok) {
      throw new Error(`Failed to fetch work items: ${workItemsResponse.statusText}`);
    }

    const workItemsData = await workItemsResponse.json();
    const allWorkItems: WorkItem[] = [];
    const grandchildIds: number[] = [];
    const grandchildParentMap = new Map<number, number>(); // grandchild ID → parent (User Story) ID

    // Process direct children - collect all work items and find grandchildren
    for (const wi of workItemsData.value as DevOpsWorkItem[]) {
      // Add all work items (Task, Bug, Issue, User Story, etc.)
      allWorkItems.push(this.mapToWorkItem(wi, featureId));

      // Also check for children (e.g., Tasks under User Stories)
      const wiWithRelations = wi as DevOpsWorkItem & {
        relations?: Array<{ rel: string; url: string }>;
      };
      for (const relation of wiWithRelations.relations || []) {
        if (relation.rel === 'System.LinkTypes.Hierarchy-Forward' && relation.url) {
          const idMatch = relation.url.match(/workItems\/(\d+)/);
          if (idMatch) {
            const grandchildId = parseInt(idMatch[1], 10);
            grandchildIds.push(grandchildId);
            grandchildParentMap.set(grandchildId, wi.id);
          }
        }
      }
    }

    // Fetch grandchildren (all work items under User Stories, etc.)
    if (grandchildIds.length > 0) {
      const grandchildResponse = await fetch(
        `${this.baseUrl}/_apis/wit/workitems?ids=${grandchildIds.join(',')}&$expand=all&api-version=7.0`,
        { headers: this.headers }
      );

      if (grandchildResponse.ok) {
        const grandchildData = await grandchildResponse.json();
        for (const wi of grandchildData.value as DevOpsWorkItem[]) {
          // Set parentId to the User Story (or other intermediate parent), not the feature
          const parentId = grandchildParentMap.get(wi.id) ?? featureId;
          allWorkItems.push(this.mapToWorkItem(wi, parentId));
        }
      }
    }

    // Sort by ID for consistent ordering
    return allWorkItems.sort((a, b) => a.id - b.id);
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

    // Sort features by backlog order (lower = higher priority / earlier in chain)
    // Agile/CMMI use StackRank, Scrum uses BacklogPriority
    features.sort((a, b) => {
      const aOrder = a.backlogPriority ?? a.stackRank ?? Number.MAX_SAFE_INTEGER;
      const bOrder = b.backlogPriority ?? b.stackRank ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Fall back to ID for stable sorting if order values are equal
      return a.id - b.id;
    });

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
      originalEstimate: (fields['Microsoft.VSTS.Scheduling.OriginalEstimate'] as number) || 0,
      // Sum all effort fields (stored in days in Azure DevOps) and convert to hours (8h/day)
      effort: sumEffortFields(fields),
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
      stackRank: fields['Microsoft.VSTS.Common.StackRank'] as number | undefined,
      backlogPriority: fields['Microsoft.VSTS.Common.BacklogPriority'] as number | undefined,
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

// SLA Level Map - Maps project names to SLA levels
// Reads from project descriptions in format: "SLA: Gold" or "sla=silver"

interface SLAMapCache {
  map: Record<string, SLALevel>;
  timestamp: number;
}

let slaMapCache: SLAMapCache | null = null;

// Fetch SLA map from DevOps project descriptions
// SLA levels should be configured in each Azure DevOps project's description
// using format: "SLA: Gold" or "sla=silver" or "SLA Level: Bronze"
// Projects without SLA configured will use DEFAULT_SLA_LEVEL (Bronze)
async function fetchSLAMapFromDevOps(): Promise<Record<string, SLALevel>> {
  const pat = process.env.AZURE_DEVOPS_PAT;
  const org = process.env.AZURE_DEVOPS_ORG || 'KnowAll';

  if (!pat) {
    console.warn('AZURE_DEVOPS_PAT not set, SLA levels will use defaults');
    return {};
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

    return slaMap;
  } catch (error) {
    console.error('Failed to fetch SLA map from DevOps:', error);
    return {};
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
