// ZapDesk Types - Azure DevOps Work Items mapped to Zendesk-like concepts

export interface User {
  id: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  accessLevel?: string;
  licenseType?: string;
}

export interface WorkItemType {
  name: string;
  referenceName: string;
  description?: string;
  color?: string;
  icon?: string;
}

export interface Organization {
  id: string;
  name: string;
  domain?: string;
  devOpsProject: string;
  devOpsOrg: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  processTemplate?: string; // Azure DevOps process template (e.g., "T-Minus-15", "Basic")
  isTemplateSupported?: boolean; // Whether this template has a config in ZapDesk
}

export interface Customer {
  id: string;
  displayName: string;
  email: string;
  organizationId?: string;
  organization?: Organization;
  timezone: string;
  tags: string[];
  avatarUrl?: string;
  lastUpdated?: Date;
  license?: string;
}

export type TicketStatus = 'New' | 'Open' | 'In Progress' | 'Pending' | 'Resolved' | 'Closed';
export type TicketPriority = 'Low' | 'Normal' | 'High' | 'Urgent';
export type SLALevel = 'Gold' | 'Silver' | 'Bronze';
export type SLARiskStatus = 'breached' | 'at-risk' | 'on-track';

// SLA Configuration per priority
export interface SLATargets {
  responseTimeHours: number;
  resolutionTimeHours: number;
}

export interface SLAConfig {
  Urgent: SLATargets;
  High: SLATargets;
  Normal: SLATargets;
  Low: SLATargets;
}

// SLA status for a ticket
export interface TicketSLAStatus {
  ticket: Ticket;
  riskStatus: SLARiskStatus;
  resolutionTarget: Date;
  responseTarget: Date;
  timeRemaining: number; // milliseconds, negative if breached
  percentageRemaining: number; // 0-100 percentage of SLA time remaining
  isResponseBreached: boolean;
  isResolutionBreached: boolean;
}

// Azure DevOps work item state
export interface WorkItemState {
  name: string;
  color: string;
  category: string;
}

// Utility function to ensure "Active" state exists in states array
export function ensureActiveState(states: WorkItemState[]): WorkItemState[] {
  if (states.some((s) => s.name === 'Active')) {
    return states;
  }
  // Insert "Active" after "New" (or at beginning if no "New" state)
  const newIndex = states.findIndex((s) => s.name === 'New');
  const activeState: WorkItemState = {
    name: 'Active',
    color: '007acc',
    category: 'InProgress',
  };
  if (newIndex >= 0) {
    return [...states.slice(0, newIndex + 1), activeState, ...states.slice(newIndex + 1)];
  }
  return [activeState, ...states];
}

export interface Ticket {
  id: number;
  workItemId: number;
  title: string;
  description: string;
  reproSteps?: string;
  systemInfo?: string;
  resolvedReason?: string;
  status: TicketStatus;
  devOpsState: string; // Original Azure DevOps state (e.g., 'New', 'Approved', 'To Do', etc.)
  priority?: TicketPriority;
  requester: Customer;
  assignee?: User;
  organization?: Organization;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
  devOpsUrl: string;
  project: string;
  comments: TicketComment[];
  attachments?: Attachment[];
}

export interface TicketComment {
  id: number;
  author: User;
  content: string;
  createdAt: Date;
  isInternal: boolean;
}

// Attachment types for tickets and comments
export interface Attachment {
  id: string;
  fileName: string;
  url: string;
  contentType: string;
  size: number;
  createdAt: Date;
  createdBy?: User;
}

// Maximum file size for attachments (25MB)
export const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;

// Allowed file types for attachments
export const ALLOWED_ATTACHMENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
];

export interface TicketFilter {
  status?: TicketStatus[];
  priority?: TicketPriority[];
  assignee?: string;
  requester?: string;
  organization?: string;
  tags?: string[];
  search?: string;
}

export interface ViewDefinition {
  id: string;
  name: string;
  icon: string;
  filter: TicketFilter;
  count?: number;
}

export interface DevOpsWorkItem {
  id: number;
  rev: number;
  fields: {
    'System.Title': string;
    'System.Description'?: string;
    'System.State': string;
    'System.Reason'?: string;
    'System.CreatedDate': string;
    'System.ChangedDate': string;
    'System.CreatedBy': DevOpsIdentity;
    'System.AssignedTo'?: DevOpsIdentity;
    'System.Tags'?: string;
    'Microsoft.VSTS.Common.Priority'?: number;
    'System.WorkItemType': string;
    'System.AreaPath': string;
    'System.TeamProject': string;
    [key: string]: unknown;
  };
  url: string;
  _links?: {
    html?: { href: string };
  };
}

export interface DevOpsIdentity {
  displayName: string;
  uniqueName: string;
  id: string;
  imageUrl?: string;
}

export interface DevOpsProject {
  id: string;
  name: string;
  description?: string;
  url: string;
  state: string;
}

// Azure DevOps Organization (account-level, contains projects)
export interface DevOpsOrganization {
  accountId: string;
  accountName: string;
  accountUri: string;
}

export interface EmailWebhookPayload {
  from: string;
  to: string;
  subject: string;
  body: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    content: string;
  }>;
}

// Session types extending next-auth
export interface ZapDeskSession {
  user: {
    id: string;
    name: string;
    email: string;
    image?: string;
    accessToken?: string;
  };
  accessToken?: string;
  error?: string;
}

// API Response types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  success: boolean;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// SLA API response
export interface SLAStatusResponse {
  summary: {
    breached: number;
    atRisk: number;
    onTrack: number;
  };
  tickets: TicketSLAStatus[];
}

// Monthly Checkpoint Dashboard Types
export interface SLAMetrics {
  avgResponseTimeHours: number;
  avgResolutionTimeHours: number;
  slaCompliancePercent: number;
}

export interface TicketTrendPoint {
  date: string;
  ticketsCreated: number;
  ticketsResolved: number;
  avgResponseTimeHours: number;
  avgResolutionTimeHours: number;
}

export interface MonthlyCheckpointStats {
  period: {
    startDate: string;
    endDate: string;
  };
  kpis: {
    totalTicketsCreated: number;
    totalTicketsResolved: number;
    totalTicketsPending: number;
    totalTicketsOpen: number;
    avgResponseTimeHours: number;
    avgResolutionTimeHours: number;
    slaCompliancePercent: number;
  };
  trends: TicketTrendPoint[];
  tickets: Ticket[];
}

export type TicketType = 'Bug' | 'Feature';

// Team member with performance metrics
export type TeamMemberStatus = 'On Track' | 'Behind' | 'Needs Attention';

export interface TeamMember extends User {
  role?: string;
  status: TeamMemberStatus;
  ticketsAssigned: number;
  ticketsResolved: number;
  weeklyResolutions: number;
  weeklyTrend?: string; // "+N" or "-N" compared to previous week
  avgResponseTime: string;
  avgResolutionTime: string;
  pendingTickets: number;
}

// Team summary statistics
export interface TeamStats {
  totalMembers: number;
  openTickets: number;
  inProgressTickets: number;
  needsAttention: number;
}

// Zap (Lightning Network) types
export interface ZapConfig {
  lightningAddress: string;
  presetAmounts: number[]; // in satoshis
  customAmountsEnabled: boolean;
}

export interface ZapPayment {
  id: string;
  ticketId: number;
  agentId: string;
  agentName: string;
  agentLightningAddress: string;
  amount: number; // in satoshis
  timestamp: Date;
  message?: string;
}

export const DEFAULT_ZAP_PRESETS = [100, 500, 1000, 5000] as const;

// Epic types for Epic/Feature visualization
export type EpicType = 'Agile' | 'CISP'; // Agile Epic or Continuous Improvement Service Plan

export interface Epic {
  id: number;
  title: string;
  description: string;
  state: string;
  epicType: EpicType;
  areaPath: string;
  project: string;
  createdAt: Date;
  updatedAt: Date;
  completedWork: number;
  remainingWork: number;
  totalWork: number;
  features: Feature[];
  devOpsUrl: string;
  tags: string[];
}

export interface Feature {
  id: number;
  title: string;
  description: string;
  state: string;
  parentId?: number;
  areaPath: string;
  project: string;
  createdAt: Date;
  updatedAt: Date;
  completedWork: number;
  remainingWork: number;
  totalWork: number;
  workItems: WorkItem[];
  devOpsUrl: string;
  tags: string[];
  priority?: TicketPriority;
}

export interface WorkItem {
  id: number;
  title: string;
  description: string;
  state: string;
  workItemType: string;
  parentId?: number;
  areaPath: string;
  project: string;
  createdAt: Date;
  updatedAt: Date;
  completedWork: number;
  remainingWork: number;
  originalEstimate: number;
  assignee?: User;
  devOpsUrl: string;
  tags: string[];
  priority?: TicketPriority;
}

// Treemap data structure for visualization
export interface TreemapNode {
  name: string;
  id: number;
  value: number; // Size based on effort/completed work
  state: string;
  type: 'epic' | 'feature' | 'workitem';
  priority?: TicketPriority;
  workItemType?: string;
  children?: TreemapNode[];
  devOpsUrl: string;
}

// Color scheme for treemap visualization
export type TreemapColorScheme = 'status' | 'priority' | 'type';

export interface TreemapConfig {
  colorScheme: TreemapColorScheme;
  showLabels: boolean;
  minBlockSize: number;
}
