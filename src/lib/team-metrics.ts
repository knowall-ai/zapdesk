/**
 * Pure metric helpers behind `/api/devops/team`.
 *
 * These were private to the route handler, which made them reachable only
 * through an authenticated request against live Azure DevOps — so the
 * thresholds that decide whether someone is "Behind" had no test at all
 * (#177). Nothing here touches the network or the session; the route still
 * owns fetching and shaping, and calls into this module for the arithmetic.
 */

import type { TeamMember, TeamMemberStatus, Ticket } from '@/types';

/** Days without an update after which an open ticket is deemed to need attention. */
const STALE_TICKET_DAYS = 3;

/**
 * Read a non-negative integer from the environment, falling back when it is
 * unset or not one.
 *
 * The whole string must be an integer. `parseInt` stops at the first
 * non-digit, so `"2abc"` used to yield 2 and `"1.5"` yielded 1 -- a typo
 * silently became a threshold nobody chose.
 *
 * Negatives are rejected outright. Ticket counts are never below zero, so a
 * negative threshold makes every `>` comparison true and reports the entire
 * team as "Needs Attention".
 *
 * There is deliberately no upper cap: an implausibly large threshold is a
 * legitimate way to switch an escalation band off, and is visible in the
 * config rather than silent.
 */
export function getIntEnv(envName: string, defaultValue: number): number {
  const raw = process.env[envName]?.trim();
  if (!raw) return defaultValue;
  if (!/^\d+$/.test(raw)) {
    console.warn(
      `[Team] ${envName} must be a non-negative integer (got "${raw}") -- using ${defaultValue}.`
    );
    return defaultValue;
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : defaultValue;
}

/** Workload thresholds, all overridable per deployment. */
export interface TeamThresholds {
  needsAttentionPending: number;
  needsAttentionAssigned: number;
  behindPending: number;
  behindAssigned: number;
}

/**
 * Current thresholds, read from the environment on each call.
 *
 * Deliberately not captured once at module load: that pinned the values to
 * whenever the module happened to be first imported, so changing one meant
 * restarting the server, and left tests no way to vary them.
 */
export function teamThresholds(): TeamThresholds {
  return {
    needsAttentionPending: getIntEnv('TEAM_THRESHOLD_NEEDS_ATTENTION_PENDING', 5),
    needsAttentionAssigned: getIntEnv('TEAM_THRESHOLD_NEEDS_ATTENTION_ASSIGNED', 15),
    behindPending: getIntEnv('TEAM_THRESHOLD_BEHIND_PENDING', 2),
    behindAssigned: getIntEnv('TEAM_THRESHOLD_BEHIND_ASSIGNED', 10),
  };
}

/**
 * Where a member sits against the workload thresholds.
 *
 * Each band is an `>` comparison, so a member exactly on a threshold is still
 * in the calmer band.
 */
export function calculateMemberStatus(
  member: Pick<TeamMember, 'pendingTickets' | 'ticketsAssigned'>,
  thresholds: TeamThresholds = teamThresholds()
): TeamMemberStatus {
  if (
    member.pendingTickets > thresholds.needsAttentionPending ||
    member.ticketsAssigned > thresholds.needsAttentionAssigned
  ) {
    return 'Needs Attention';
  }
  if (
    member.pendingTickets > thresholds.behindPending ||
    member.ticketsAssigned > thresholds.behindAssigned
  ) {
    return 'Behind';
  }
  return 'On Track';
}

/**
 * Rough response time, banded by how much work someone is carrying.
 *
 * This is an estimate from workload, not a measurement — ZapDesk does not yet
 * record first-response timestamps. Issue #179 tracks calculating it for real.
 */
export function calculateAvgResponseTime(member: Pick<TeamMember, 'ticketsAssigned'>): string {
  if (member.ticketsAssigned > 10) return '> 4 hours';
  if (member.ticketsAssigned > 5) return '2-4 hours';
  return '< 2 hours';
}

/**
 * Mean of the given resolution durations, rendered at the coarsest unit that
 * still says something useful.
 *
 * Returns `-` for no data, which is distinct from a genuine zero.
 */
export function calculateAvgResolutionTime(
  resolutionTimesMs: readonly number[] | undefined
): string {
  if (!resolutionTimesMs || resolutionTimesMs.length === 0) return '-';

  const avgMs = resolutionTimesMs.reduce((sum, t) => sum + t, 0) / resolutionTimesMs.length;
  const avgHours = avgMs / (1000 * 60 * 60);
  const avgDays = avgHours / 24;

  if (avgDays >= 7) return `${Math.round(avgDays / 7)}w`;
  if (avgDays >= 1) return `${Math.round(avgDays)}d`;
  if (avgHours >= 1) return `${Math.round(avgHours)}h`;
  return '< 1h';
}

/**
 * Count of tickets the team should look at: unassigned new work, and anything
 * still open that has not moved in `STALE_TICKET_DAYS`.
 *
 * @param now Injectable clock, so the staleness boundary is testable.
 */
export function calculateNeedsAttention(
  tickets: readonly Ticket[],
  now: Date = new Date()
): number {
  const staleBefore = new Date(now);
  staleBefore.setDate(staleBefore.getDate() - STALE_TICKET_DAYS);

  return tickets.filter((t) => {
    if (!t.assignee && (t.status === 'New' || t.status === 'Open')) return true;
    return (
      t.updatedAt < staleBefore &&
      (t.status === 'Open' || t.status === 'In Progress' || t.status === 'Pending')
    );
  }).length;
}

/**
 * True when `email` sits in `internalDomain`.
 *
 * The domain is taken from the signed-in user, which is how the team list
 * stays to colleagues rather than every customer who has ever been assigned a
 * ticket. Comparison is exact: a subdomain is a different organisation, and
 * suffix matching would let `evil-knowall.ai` in.
 */
export function isInternalUser(email: string, internalDomain: string): boolean {
  if (!email || !internalDomain) return false;

  // Exactly one `@`, with something either side. Splitting on the first `@`
  // and trusting the remainder let `@knowall.ai` through with an empty local
  // part, and read `user@knowall.ai@evil.example` as belonging to knowall.ai.
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return false;

  const memberDomain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  if (!memberDomain) return false;

  return memberDomain === internalDomain.trim().toLowerCase();
}
