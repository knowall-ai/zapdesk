// SLA Calculation Utilities
import type {
  Ticket,
  TicketPriority,
  TicketStatus,
  SLAConfig,
  SLATargets,
  SLARiskStatus,
  TicketSLAStatus,
} from '@/types';

// Default SLA targets by priority (in hours)
// These can be overridden via environment variables
const DEFAULT_SLA_CONFIG: SLAConfig = {
  Urgent: { responseTimeHours: 1, resolutionTimeHours: 4 },
  High: { responseTimeHours: 4, resolutionTimeHours: 8 },
  Normal: { responseTimeHours: 8, resolutionTimeHours: 24 },
  Low: { responseTimeHours: 24, resolutionTimeHours: 72 },
};

// Risk threshold: percentage of SLA time remaining below which ticket is "at risk"
const AT_RISK_THRESHOLD = 25; // 25% remaining = at risk

/**
 * Get SLA configuration, allowing for environment variable overrides
 */
export function getSLAConfig(): SLAConfig {
  const envConfig = process.env.SLA_CONFIG;

  if (envConfig) {
    try {
      return JSON.parse(envConfig) as SLAConfig;
    } catch {
      console.warn('Failed to parse SLA_CONFIG environment variable, using defaults');
    }
  }

  return DEFAULT_SLA_CONFIG;
}

/**
 * Get SLA targets for a specific priority
 */
export function getSLATargetsForPriority(priority: TicketPriority): SLATargets {
  const config = getSLAConfig();
  return config[priority];
}

/**
 * Calculate the resolution deadline for a ticket
 */
export function calculateResolutionDeadline(ticket: Ticket): Date {
  const targets = getSLATargetsForPriority(ticket.priority);
  const createdAt = new Date(ticket.createdAt);
  return new Date(createdAt.getTime() + targets.resolutionTimeHours * 60 * 60 * 1000);
}

/**
 * Calculate the response deadline for a ticket
 */
export function calculateResponseDeadline(ticket: Ticket): Date {
  const targets = getSLATargetsForPriority(ticket.priority);
  const createdAt = new Date(ticket.createdAt);
  return new Date(createdAt.getTime() + targets.responseTimeHours * 60 * 60 * 1000);
}

/**
 * Check if a ticket status indicates it's still active (needs resolution)
 */
export function isActiveTicketStatus(status: TicketStatus): boolean {
  return ['New', 'Open', 'In Progress', 'Pending'].includes(status);
}

/**
 * Calculate SLA status for a single ticket
 */
export function calculateTicketSLAStatus(ticket: Ticket, now: Date = new Date()): TicketSLAStatus {
  const targets = getSLATargetsForPriority(ticket.priority);
  const createdAt = new Date(ticket.createdAt);

  const responseTarget = calculateResponseDeadline(ticket);
  const resolutionTarget = calculateResolutionDeadline(ticket);

  // Time remaining until resolution deadline
  const timeRemaining = resolutionTarget.getTime() - now.getTime();

  // Total SLA time in milliseconds
  const totalSLATime = targets.resolutionTimeHours * 60 * 60 * 1000;

  // Time elapsed since ticket creation
  const timeElapsed = now.getTime() - createdAt.getTime();

  // Percentage of SLA time remaining
  const percentageRemaining = Math.max(0, ((totalSLATime - timeElapsed) / totalSLATime) * 100);

  // Check breach status
  const isResponseBreached = now > responseTarget;
  const isResolutionBreached = now > resolutionTarget;

  // Determine risk status
  let riskStatus: SLARiskStatus;
  if (isResolutionBreached) {
    riskStatus = 'breached';
  } else if (percentageRemaining <= AT_RISK_THRESHOLD) {
    riskStatus = 'at-risk';
  } else {
    riskStatus = 'on-track';
  }

  return {
    ticket,
    riskStatus,
    resolutionTarget,
    responseTarget,
    timeRemaining,
    percentageRemaining,
    isResponseBreached,
    isResolutionBreached,
  };
}

/**
 * Calculate SLA status for multiple tickets, filtering to only active tickets
 */
export function calculateSLAStatusForTickets(
  tickets: Ticket[],
  now: Date = new Date()
): TicketSLAStatus[] {
  return tickets
    .filter((ticket) => isActiveTicketStatus(ticket.status))
    .map((ticket) => calculateTicketSLAStatus(ticket, now));
}

/**
 * Sort SLA statuses by urgency (breached first, then at-risk, then by time remaining)
 */
export function sortByUrgency(statuses: TicketSLAStatus[]): TicketSLAStatus[] {
  return [...statuses].sort((a, b) => {
    // Breached tickets first
    if (a.riskStatus === 'breached' && b.riskStatus !== 'breached') return -1;
    if (b.riskStatus === 'breached' && a.riskStatus !== 'breached') return 1;

    // At-risk tickets next
    if (a.riskStatus === 'at-risk' && b.riskStatus === 'on-track') return -1;
    if (b.riskStatus === 'at-risk' && a.riskStatus === 'on-track') return 1;

    // Then by time remaining (ascending - less time = more urgent)
    return a.timeRemaining - b.timeRemaining;
  });
}

/**
 * Format time remaining/overdue in a human-readable format
 */
export function formatTimeRemaining(milliseconds: number): string {
  const isOverdue = milliseconds < 0;
  const absMs = Math.abs(milliseconds);

  const hours = Math.floor(absMs / (1000 * 60 * 60));
  const minutes = Math.floor((absMs % (1000 * 60 * 60)) / (1000 * 60));

  let timeStr: string;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    timeStr = remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  } else if (hours > 0) {
    timeStr = `${hours}h ${minutes}m`;
  } else {
    timeStr = `${minutes}m`;
  }

  return isOverdue ? `${timeStr} overdue` : `${timeStr} remaining`;
}

/**
 * Get summary counts for SLA status
 */
export function getSLASummary(statuses: TicketSLAStatus[]): {
  breached: number;
  atRisk: number;
  onTrack: number;
} {
  return {
    breached: statuses.filter((s) => s.riskStatus === 'breached').length,
    atRisk: statuses.filter((s) => s.riskStatus === 'at-risk').length,
    onTrack: statuses.filter((s) => s.riskStatus === 'on-track').length,
  };
}
