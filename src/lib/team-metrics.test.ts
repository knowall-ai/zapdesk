import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  calculateAvgResolutionTime,
  calculateAvgResponseTime,
  calculateMemberStatus,
  calculateNeedsAttention,
  getIntEnv,
  isInternalUser,
  teamThresholds,
} from './team-metrics';
import type { Ticket, TicketStatus } from '@/types';

const THRESHOLD_VARS = [
  'TEAM_THRESHOLD_NEEDS_ATTENTION_PENDING',
  'TEAM_THRESHOLD_NEEDS_ATTENTION_ASSIGNED',
  'TEAM_THRESHOLD_BEHIND_PENDING',
  'TEAM_THRESHOLD_BEHIND_ASSIGNED',
] as const;

const originals = new Map<string, string | undefined>();

beforeEach(() => {
  for (const v of THRESHOLD_VARS) {
    originals.set(v, process.env[v]);
    delete process.env[v];
  }
});

afterEach(() => {
  for (const v of THRESHOLD_VARS) {
    const was = originals.get(v);
    if (was === undefined) delete process.env[v];
    else process.env[v] = was;
  }
});

const hour = 1000 * 60 * 60;
const day = hour * 24;

describe('getIntEnv', () => {
  it('returns the default when unset', () => {
    expect(getIntEnv('TEAM_THRESHOLD_BEHIND_PENDING', 2)).toBe(2);
  });

  it('reads a configured integer', () => {
    process.env.TEAM_THRESHOLD_BEHIND_PENDING = '7';
    expect(getIntEnv('TEAM_THRESHOLD_BEHIND_PENDING', 2)).toBe(7);
  });

  it('treats blank and whitespace as unset', () => {
    process.env.TEAM_THRESHOLD_BEHIND_PENDING = '   ';
    expect(getIntEnv('TEAM_THRESHOLD_BEHIND_PENDING', 2)).toBe(2);
  });

  // A NaN threshold makes every `>` comparison false, which would quietly
  // report the entire team as On Track however buried they are.
  it('falls back rather than yielding NaN for a malformed value', () => {
    process.env.TEAM_THRESHOLD_BEHIND_PENDING = 'five';
    expect(getIntEnv('TEAM_THRESHOLD_BEHIND_PENDING', 2)).toBe(2);
  });

  it('accepts zero as a real value, not a missing one', () => {
    process.env.TEAM_THRESHOLD_BEHIND_PENDING = '0';
    expect(getIntEnv('TEAM_THRESHOLD_BEHIND_PENDING', 2)).toBe(0);
  });
});

describe('teamThresholds', () => {
  it('uses the documented defaults', () => {
    expect(teamThresholds()).toEqual({
      needsAttentionPending: 5,
      needsAttentionAssigned: 15,
      behindPending: 2,
      behindAssigned: 10,
    });
  });

  // Read per call, not captured at import: otherwise changing one needs a
  // server restart, and tests cannot vary them at all.
  it('picks up a change without the module being reloaded', () => {
    expect(teamThresholds().behindAssigned).toBe(10);
    process.env.TEAM_THRESHOLD_BEHIND_ASSIGNED = '3';
    expect(teamThresholds().behindAssigned).toBe(3);
  });
});

describe('calculateMemberStatus', () => {
  const member = (pendingTickets: number, ticketsAssigned: number) => ({
    pendingTickets,
    ticketsAssigned,
  });

  it('is On Track for a light load', () => {
    expect(calculateMemberStatus(member(0, 0))).toBe('On Track');
    expect(calculateMemberStatus(member(2, 10))).toBe('On Track');
  });

  // Each band is a strict `>`, so sitting exactly on a threshold stays in the
  // calmer band. Worth pinning: an off-by-one here relabels the whole team.
  it('treats a value exactly on a threshold as the calmer band', () => {
    expect(calculateMemberStatus(member(2, 0))).toBe('On Track');
    expect(calculateMemberStatus(member(3, 0))).toBe('Behind');
    expect(calculateMemberStatus(member(0, 10))).toBe('On Track');
    expect(calculateMemberStatus(member(0, 11))).toBe('Behind');
    expect(calculateMemberStatus(member(5, 0))).toBe('Behind');
    expect(calculateMemberStatus(member(6, 0))).toBe('Needs Attention');
    expect(calculateMemberStatus(member(0, 15))).toBe('Behind');
    expect(calculateMemberStatus(member(0, 16))).toBe('Needs Attention');
  });

  it('escalates on either count alone', () => {
    expect(calculateMemberStatus(member(6, 0))).toBe('Needs Attention');
    expect(calculateMemberStatus(member(0, 16))).toBe('Needs Attention');
  });

  it('honours configured thresholds', () => {
    process.env.TEAM_THRESHOLD_BEHIND_ASSIGNED = '1';
    expect(calculateMemberStatus(member(0, 2))).toBe('Behind');
  });

  it('accepts thresholds passed in directly', () => {
    const strict = {
      needsAttentionPending: 1,
      needsAttentionAssigned: 2,
      behindPending: 0,
      behindAssigned: 1,
    };
    expect(calculateMemberStatus(member(0, 3), strict)).toBe('Needs Attention');
    expect(calculateMemberStatus(member(0, 0), strict)).toBe('On Track');
  });
});

describe('calculateAvgResponseTime', () => {
  it('bands by workload', () => {
    expect(calculateAvgResponseTime({ ticketsAssigned: 0 })).toBe('< 2 hours');
    expect(calculateAvgResponseTime({ ticketsAssigned: 5 })).toBe('< 2 hours');
    expect(calculateAvgResponseTime({ ticketsAssigned: 6 })).toBe('2-4 hours');
    expect(calculateAvgResponseTime({ ticketsAssigned: 10 })).toBe('2-4 hours');
    expect(calculateAvgResponseTime({ ticketsAssigned: 11 })).toBe('> 4 hours');
  });
});

describe('calculateAvgResolutionTime', () => {
  it('reports no data distinctly from zero', () => {
    expect(calculateAvgResolutionTime(undefined)).toBe('-');
    expect(calculateAvgResolutionTime([])).toBe('-');
    expect(calculateAvgResolutionTime([0])).toBe('< 1h');
  });

  it('renders at the coarsest useful unit', () => {
    expect(calculateAvgResolutionTime([30 * 60 * 1000])).toBe('< 1h');
    expect(calculateAvgResolutionTime([3 * hour])).toBe('3h');
    expect(calculateAvgResolutionTime([2 * day])).toBe('2d');
    expect(calculateAvgResolutionTime([14 * day])).toBe('2w');
  });

  it('averages rather than taking the first or last', () => {
    expect(calculateAvgResolutionTime([1 * hour, 5 * hour])).toBe('3h');
  });
});

describe('calculateNeedsAttention', () => {
  const now = new Date('2026-09-15T12:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * day);

  const ticket = (over: Partial<Ticket> & { status: TicketStatus }): Ticket =>
    ({
      id: '1',
      title: 't',
      status: over.status,
      createdAt: daysAgo(30),
      updatedAt: over.updatedAt ?? now,
      assignee: over.assignee,
    }) as unknown as Ticket;

  it('counts unassigned new and open work', () => {
    expect(calculateNeedsAttention([ticket({ status: 'New' })], now)).toBe(1);
    expect(calculateNeedsAttention([ticket({ status: 'Open' })], now)).toBe(1);
  });

  it('ignores unassigned work that is already resolved or closed', () => {
    expect(calculateNeedsAttention([ticket({ status: 'Resolved' })], now)).toBe(0);
    expect(calculateNeedsAttention([ticket({ status: 'Closed' })], now)).toBe(0);
  });

  it('ignores assigned work that is moving', () => {
    const assigned = { email: 'a@knowall.ai' } as Ticket['assignee'];
    expect(
      calculateNeedsAttention([ticket({ status: 'In Progress', assignee: assigned })], now)
    ).toBe(0);
  });

  it('counts assigned work that has gone stale', () => {
    const assigned = { email: 'a@knowall.ai' } as Ticket['assignee'];
    const stale = ticket({ status: 'In Progress', assignee: assigned, updatedAt: daysAgo(4) });
    expect(calculateNeedsAttention([stale], now)).toBe(1);
  });

  it('does not count a ticket that is exactly at the staleness boundary', () => {
    const assigned = { email: 'a@knowall.ai' } as Ticket['assignee'];
    const boundary = ticket({ status: 'Open', assignee: assigned, updatedAt: daysAgo(3) });
    expect(calculateNeedsAttention([boundary], now)).toBe(0);
  });

  // An unassigned stale ticket satisfies both rules; it is one ticket needing
  // attention, not two.
  it('counts a ticket once even when it is both unassigned and stale', () => {
    const both = ticket({ status: 'Open', updatedAt: daysAgo(10) });
    expect(calculateNeedsAttention([both], now)).toBe(1);
  });

  it('is zero for an empty list', () => {
    expect(calculateNeedsAttention([], now)).toBe(0);
  });
});

describe('isInternalUser', () => {
  it('accepts a colleague on the same domain', () => {
    expect(isInternalUser('ben@knowall.ai', 'knowall.ai')).toBe(true);
  });

  it('is case-insensitive on both sides', () => {
    expect(isInternalUser('Ben@KnowAll.AI', 'knowall.ai')).toBe(true);
    expect(isInternalUser('ben@knowall.ai', 'KnowAll.ai')).toBe(true);
  });

  it('rejects an outside domain', () => {
    expect(isInternalUser('customer@example.com', 'knowall.ai')).toBe(false);
  });

  // Exact match, not a suffix: otherwise anyone who registers a domain ending
  // in the internal one is treated as staff.
  it('rejects a lookalike domain that merely ends with the internal one', () => {
    expect(isInternalUser('attacker@evil-knowall.ai', 'knowall.ai')).toBe(false);
    expect(isInternalUser('attacker@mail.knowall.ai', 'knowall.ai')).toBe(false);
  });

  it('rejects missing or malformed input', () => {
    expect(isInternalUser('', 'knowall.ai')).toBe(false);
    expect(isInternalUser('ben@knowall.ai', '')).toBe(false);
    expect(isInternalUser('not-an-email', 'knowall.ai')).toBe(false);
  });
});
