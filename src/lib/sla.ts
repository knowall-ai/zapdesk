// SLA (Service Level Agreement) Utility Functions
// Provides hardcoded SLA policies and calculation utilities

import type {
  SLALevel,
  SLAPolicy,
  SLAStatus,
  SLATargets,
  TicketSLAInfo,
  TicketPriority,
  Ticket,
} from '@/types';

// Hardcoded SLA Policies based on KnowAll Support Contracts
// Inspired by Bitcoin blockchain fee market tiers
//
// IMPORTANT: Current Implementation Limitations
// ---------------------------------------------
// - Using calendar hours as approximation (not true business hours)
// - Business hours are Mon-Fri 9am-5pm UK time (8 hours/day)
// - UK bank holidays should be excluded (not yet implemented)
// - Pending time (waiting for customer response) should pause SLA (not yet implemented)
//
// First Response: Time between ticket creation and first comment/response
// Target Resolution: Time between ticket creation and resolution
//
// SLAs apply to incident-related tickets only (Tasks, Bugs, Questions).
// Enhancements and Features are scheduled through backlog at Checkpoints.

// Time constants in minutes
const HOURS = 60;

// Business day approximation using calendar hours
// TODO: Implement proper business hours calculation (Mon-Fri 9am-5pm UK)
// Actual business hours per day: 8 hours
// Using 24 calendar hours as approximation for simplicity
const BUSINESS_DAY = 24 * HOURS;

export const SLA_POLICIES: Record<SLALevel, SLAPolicy> = {
  Gold: {
    level: 'Gold',
    name: 'Gold SLA 🥇',
    description:
      'Like paying a higher miner fee — your transaction goes straight to the front of the queue. Priority scheduling, expedited turnaround, and strategic advisory sessions.',
    targets: {
      // Gold: 4 hour first response, 1 business day resolution
      urgent: { firstResponseMinutes: 4 * HOURS, resolutionMinutes: 1 * BUSINESS_DAY },
      high: { firstResponseMinutes: 4 * HOURS, resolutionMinutes: 1 * BUSINESS_DAY },
      normal: { firstResponseMinutes: 4 * HOURS, resolutionMinutes: 1 * BUSINESS_DAY },
      low: { firstResponseMinutes: 4 * HOURS, resolutionMinutes: 1 * BUSINESS_DAY },
    },
  },
  Silver: {
    level: 'Silver',
    name: 'Silver SLA 🥈',
    description:
      'Comparable to a medium-fee transaction — confirmed more quickly with greater predictability. Proactive monitoring, backlog grooming, and higher-priority scheduling.',
    targets: {
      // Silver: 8 hour first response, 2 business days resolution
      urgent: { firstResponseMinutes: 8 * HOURS, resolutionMinutes: 2 * BUSINESS_DAY },
      high: { firstResponseMinutes: 8 * HOURS, resolutionMinutes: 2 * BUSINESS_DAY },
      normal: { firstResponseMinutes: 8 * HOURS, resolutionMinutes: 2 * BUSINESS_DAY },
      low: { firstResponseMinutes: 8 * HOURS, resolutionMinutes: 2 * BUSINESS_DAY },
    },
  },
  Bronze: {
    level: 'Bronze',
    name: 'Bronze SLA 🥉',
    description:
      'Like a Bitcoin transaction with a low fee — it will get confirmed, but only when network capacity allows. Access to bug fixes, configuration tasks, questions, and small enhancements at a predictable rate.',
    targets: {
      // Bronze: 16 hour first response, 3 business days resolution
      urgent: { firstResponseMinutes: 16 * HOURS, resolutionMinutes: 3 * BUSINESS_DAY },
      high: { firstResponseMinutes: 16 * HOURS, resolutionMinutes: 3 * BUSINESS_DAY },
      normal: { firstResponseMinutes: 16 * HOURS, resolutionMinutes: 3 * BUSINESS_DAY },
      low: { firstResponseMinutes: 16 * HOURS, resolutionMinutes: 3 * BUSINESS_DAY },
    },
  },
};

// Default SLA level if none is specified
export const DEFAULT_SLA_LEVEL: SLALevel = 'Bronze';

// At-risk threshold: percentage of time remaining before marking as "at risk"
const AT_RISK_THRESHOLD = 0.25; // 25% of time remaining

/**
 * Parse SLA level from project description
 * Expected format: "SLA: Gold" or "sla=silver" or "SLA Level: Bronze"
 */
export function parseSLAFromDescription(description: string): SLALevel | undefined {
  if (!description) return undefined;

  // Match patterns like "SLA: Gold", "sla=silver", "SLA Level: Bronze"
  const slaMatch = description.match(/sla(?:\s*level)?\s*[=:]\s*(gold|silver|bronze)/i);
  if (!slaMatch) return undefined;

  const level = slaMatch[1].toLowerCase();
  if (level === 'gold') return 'Gold';
  if (level === 'silver') return 'Silver';
  if (level === 'bronze') return 'Bronze';

  return undefined;
}

/**
 * Get SLA policy for a given level
 */
export function getSLAPolicy(level: SLALevel): SLAPolicy {
  return SLA_POLICIES[level];
}

/**
 * Get SLA targets for a specific priority level
 */
export function getSLATargets(policy: SLAPolicy, priority: TicketPriority): SLATargets {
  const priorityKey = priority.toLowerCase() as 'urgent' | 'high' | 'normal' | 'low';
  return policy.targets[priorityKey];
}

/**
 * Calculate SLA status based on elapsed time and target
 */
export function calculateSLAStatus(
  elapsedMinutes: number,
  targetMinutes: number,
  isMet: boolean
): SLAStatus {
  // If already met (responded/resolved), check if it was within SLA
  if (isMet) {
    return elapsedMinutes <= targetMinutes ? 'within_sla' : 'breached';
  }

  // Still in progress
  const remainingMinutes = targetMinutes - elapsedMinutes;

  if (remainingMinutes <= 0) {
    return 'breached';
  }

  // At risk if less than 25% of time remaining
  const percentRemaining = remainingMinutes / targetMinutes;
  if (percentRemaining <= AT_RISK_THRESHOLD) {
    return 'at_risk';
  }

  return 'within_sla';
}

/**
 * Calculate minutes elapsed since a date
 */
export function minutesSince(date: Date): number {
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
}

/**
 * Calculate full SLA information for a ticket
 */
export function calculateTicketSLA(
  ticket: Ticket,
  slaLevel: SLALevel = DEFAULT_SLA_LEVEL
): TicketSLAInfo {
  const policy = getSLAPolicy(slaLevel);
  const targets = getSLATargets(policy, ticket.priority);

  // Calculate first response SLA
  const firstResponseMet = !!ticket.firstResponseAt;
  const firstResponseElapsed = firstResponseMet
    ? Math.floor((ticket.firstResponseAt!.getTime() - ticket.createdAt.getTime()) / (1000 * 60))
    : minutesSince(ticket.createdAt);

  const firstResponseRemaining = Math.max(0, targets.firstResponseMinutes - firstResponseElapsed);
  const firstResponseStatus = calculateSLAStatus(
    firstResponseElapsed,
    targets.firstResponseMinutes,
    firstResponseMet
  );

  // Calculate resolution SLA
  const isResolved = ticket.status === 'Resolved' || ticket.status === 'Closed';
  const resolutionMet = isResolved && !!ticket.resolvedAt;
  const resolutionElapsed = resolutionMet
    ? Math.floor((ticket.resolvedAt!.getTime() - ticket.createdAt.getTime()) / (1000 * 60))
    : minutesSince(ticket.createdAt);

  const resolutionRemaining = Math.max(0, targets.resolutionMinutes - resolutionElapsed);
  const resolutionStatus = calculateSLAStatus(
    resolutionElapsed,
    targets.resolutionMinutes,
    resolutionMet
  );

  return {
    level: slaLevel,
    policy,
    firstResponse: {
      targetMinutes: targets.firstResponseMinutes,
      elapsedMinutes: firstResponseElapsed,
      remainingMinutes: firstResponseRemaining,
      status: firstResponseStatus,
      met: firstResponseMet,
    },
    resolution: {
      targetMinutes: targets.resolutionMinutes,
      elapsedMinutes: resolutionElapsed,
      remainingMinutes: resolutionRemaining,
      status: resolutionStatus,
      met: resolutionMet,
    },
  };
}

/**
 * Format minutes into a human-readable string
 */
export function formatDuration(minutes: number): string {
  if (minutes < 0) {
    return 'Overdue';
  }

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  if (remainingHours > 0) {
    return `${days}d ${remainingHours}h`;
  }

  return `${days}d`;
}

/**
 * Get CSS class for SLA status
 */
export function getSLAStatusClass(status: SLAStatus): string {
  switch (status) {
    case 'within_sla':
      return 'sla-within';
    case 'at_risk':
      return 'sla-at-risk';
    case 'breached':
      return 'sla-breached';
    default:
      return '';
  }
}

/**
 * Get display label for SLA status
 */
export function getSLAStatusLabel(status: SLAStatus): string {
  switch (status) {
    case 'within_sla':
      return 'Within SLA';
    case 'at_risk':
      return 'At Risk';
    case 'breached':
      return 'Breached';
    default:
      return 'Unknown';
  }
}
