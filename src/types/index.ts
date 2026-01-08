// DevDesk Types - Azure DevOps Work Items mapped to Zendesk-like concepts

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
}

export type TicketStatus = 'New' | 'Open' | 'In Progress' | 'Pending' | 'Resolved' | 'Closed';
export type TicketPriority = 'Low' | 'Normal' | 'High' | 'Urgent';
export type SLALevel = 'Gold' | 'Silver' | 'Bronze';

export interface Ticket {
  id: number;
  workItemId: number;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
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
}

export interface TicketComment {
  id: number;
  author: User;
  content: string;
  createdAt: Date;
  isInternal: boolean;
}

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
export interface DevDeskSession {
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

// Team member with performance metrics
export type TeamMemberStatus = 'On Track' | 'Behind' | 'Needs Attention';

export interface TeamMember extends User {
  role?: string;
  status: TeamMemberStatus;
  ticketsAssigned: number;
  ticketsResolved: number;
  weeklyResolutions: number;
  avgResponseTime: string;
  pendingTickets: number;
}

// Team summary statistics
export interface TeamStats {
  totalMembers: number;
  openTickets: number;
  inProgressTickets: number;
  needsAttention: number;
}
