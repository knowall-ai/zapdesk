import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseSLAFromDescription,
  getSLAPolicy,
  getSLATargets,
  calculateSLAStatus,
  calculateTicketSLA,
  formatDuration,
  getSLAStatusClass,
  getSLAStatusLabel,
  SLA_POLICIES,
  DEFAULT_SLA_LEVEL,
} from './sla';
import type { Ticket, TicketPriority } from '@/types';

describe('parseSLAFromDescription', () => {
  it('should parse "SLA: Gold" format', () => {
    expect(parseSLAFromDescription('SLA: Gold')).toBe('Gold');
    expect(parseSLAFromDescription('SLA: Silver')).toBe('Silver');
    expect(parseSLAFromDescription('SLA: Bronze')).toBe('Bronze');
  });

  it('should parse "sla=level" format', () => {
    expect(parseSLAFromDescription('sla=gold')).toBe('Gold');
    expect(parseSLAFromDescription('sla=silver')).toBe('Silver');
    expect(parseSLAFromDescription('sla=bronze')).toBe('Bronze');
  });

  it('should parse "SLA Level: level" format', () => {
    expect(parseSLAFromDescription('SLA Level: Gold')).toBe('Gold');
    expect(parseSLAFromDescription('SLA Level: Silver')).toBe('Silver');
    expect(parseSLAFromDescription('SLA Level: Bronze')).toBe('Bronze');
  });

  it('should be case insensitive', () => {
    expect(parseSLAFromDescription('SLA: GOLD')).toBe('Gold');
    expect(parseSLAFromDescription('sla: silver')).toBe('Silver');
    expect(parseSLAFromDescription('Sla: BrOnZe')).toBe('Bronze');
  });

  it('should parse SLA from larger text', () => {
    const description = 'This is a project for client X.\nSLA: Gold\nEmail: client@example.com';
    expect(parseSLAFromDescription(description)).toBe('Gold');
  });

  it('should return undefined for empty description', () => {
    expect(parseSLAFromDescription('')).toBeUndefined();
  });

  it('should return undefined for description without SLA', () => {
    expect(parseSLAFromDescription('Just a regular description')).toBeUndefined();
  });

  it('should return undefined for invalid SLA level', () => {
    expect(parseSLAFromDescription('SLA: Platinum')).toBeUndefined();
  });
});

describe('getSLAPolicy', () => {
  it('should return Gold policy', () => {
    const policy = getSLAPolicy('Gold');
    expect(policy.level).toBe('Gold');
    expect(policy.name).toContain('Gold');
  });

  it('should return Silver policy', () => {
    const policy = getSLAPolicy('Silver');
    expect(policy.level).toBe('Silver');
    expect(policy.name).toContain('Silver');
  });

  it('should return Bronze policy', () => {
    const policy = getSLAPolicy('Bronze');
    expect(policy.level).toBe('Bronze');
    expect(policy.name).toContain('Bronze');
  });
});

describe('getSLATargets', () => {
  it('should return targets for Gold urgent priority', () => {
    const policy = getSLAPolicy('Gold');
    const targets = getSLATargets(policy, 'Urgent');
    expect(targets.firstResponseMinutes).toBe(4 * 60); // 4 hours
    expect(targets.resolutionMinutes).toBe(24 * 60); // 1 day
  });

  it('should return targets for Silver normal priority', () => {
    const policy = getSLAPolicy('Silver');
    const targets = getSLATargets(policy, 'Normal');
    expect(targets.firstResponseMinutes).toBe(8 * 60); // 8 hours
    expect(targets.resolutionMinutes).toBe(48 * 60); // 2 days
  });

  it('should return targets for Bronze low priority', () => {
    const policy = getSLAPolicy('Bronze');
    const targets = getSLATargets(policy, 'Low');
    expect(targets.firstResponseMinutes).toBe(16 * 60); // 16 hours
    expect(targets.resolutionMinutes).toBe(72 * 60); // 3 days
  });
});

describe('calculateSLAStatus', () => {
  describe('when SLA is met', () => {
    it('should return within_sla when completed within target', () => {
      expect(calculateSLAStatus(100, 200, true)).toBe('within_sla');
    });

    it('should return within_sla when completed exactly at target', () => {
      expect(calculateSLAStatus(200, 200, true)).toBe('within_sla');
    });

    it('should return breached when completed after target', () => {
      expect(calculateSLAStatus(300, 200, true)).toBe('breached');
    });
  });

  describe('when SLA is not yet met (in progress)', () => {
    it('should return within_sla when plenty of time remaining', () => {
      expect(calculateSLAStatus(50, 200, false)).toBe('within_sla');
    });

    it('should return at_risk when less than 25% time remaining', () => {
      // 160 elapsed out of 200 = 40 remaining = 20% remaining
      expect(calculateSLAStatus(160, 200, false)).toBe('at_risk');
    });

    it('should return at_risk at exactly 25% threshold', () => {
      // 150 elapsed out of 200 = 50 remaining = 25% remaining
      expect(calculateSLAStatus(150, 200, false)).toBe('at_risk');
    });

    it('should return within_sla just above 25% threshold', () => {
      // 149 elapsed out of 200 = 51 remaining = 25.5% remaining
      expect(calculateSLAStatus(149, 200, false)).toBe('within_sla');
    });

    it('should return breached when time exceeded', () => {
      expect(calculateSLAStatus(250, 200, false)).toBe('breached');
    });

    it('should return breached when time exactly at target', () => {
      expect(calculateSLAStatus(200, 200, false)).toBe('breached');
    });
  });
});

describe('calculateTicketSLA', () => {
  let mockDate: Date;

  beforeEach(() => {
    // Mock the current time
    mockDate = new Date('2024-01-15T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createMockTicket(overrides: Partial<Ticket> = {}): Ticket {
    return {
      id: 1,
      workItemId: 1,
      title: 'Test Ticket',
      description: 'Test description',
      status: 'Open',
      priority: 'Normal' as TicketPriority,
      requester: {
        id: '1',
        displayName: 'Test User',
        email: 'test@example.com',
        timezone: 'UTC',
        tags: [],
        lastUpdated: new Date(),
      },
      tags: [],
      createdAt: new Date('2024-01-15T10:00:00Z'), // 2 hours ago
      updatedAt: new Date('2024-01-15T11:00:00Z'),
      devOpsUrl: 'https://dev.azure.com/test',
      project: 'Test',
      comments: [],
      ...overrides,
    };
  }

  it('should calculate SLA for ticket within SLA', () => {
    const ticket = createMockTicket();
    const slaInfo = calculateTicketSLA(ticket, 'Gold');

    expect(slaInfo.level).toBe('Gold');
    expect(slaInfo.firstResponse.targetMinutes).toBe(4 * 60);
    expect(slaInfo.firstResponse.elapsedMinutes).toBe(120); // 2 hours
    expect(slaInfo.firstResponse.status).toBe('within_sla');
    expect(slaInfo.firstResponse.met).toBe(false);
  });

  it('should calculate SLA for ticket with first response met', () => {
    const ticket = createMockTicket({
      firstResponseAt: new Date('2024-01-15T10:30:00Z'), // 30 min after creation
    });
    const slaInfo = calculateTicketSLA(ticket, 'Gold');

    expect(slaInfo.firstResponse.elapsedMinutes).toBe(30);
    expect(slaInfo.firstResponse.status).toBe('within_sla');
    expect(slaInfo.firstResponse.met).toBe(true);
  });

  it('should calculate SLA for resolved ticket', () => {
    const ticket = createMockTicket({
      status: 'Resolved',
      firstResponseAt: new Date('2024-01-15T10:30:00Z'),
      resolvedAt: new Date('2024-01-15T11:00:00Z'), // 1 hour after creation
    });
    const slaInfo = calculateTicketSLA(ticket, 'Gold');

    expect(slaInfo.resolution.elapsedMinutes).toBe(60);
    expect(slaInfo.resolution.status).toBe('within_sla');
    expect(slaInfo.resolution.met).toBe(true);
  });

  it('should mark ticket as at_risk when close to SLA breach', () => {
    // Create ticket 3.5 hours ago for Gold (4 hour target)
    const ticket = createMockTicket({
      createdAt: new Date('2024-01-15T08:30:00Z'), // 3.5 hours ago = 210 minutes
    });
    const slaInfo = calculateTicketSLA(ticket, 'Gold');

    // 210 minutes elapsed, 240 target, 30 remaining = 12.5% remaining
    expect(slaInfo.firstResponse.elapsedMinutes).toBe(210);
    expect(slaInfo.firstResponse.status).toBe('at_risk');
  });

  it('should mark ticket as breached when SLA exceeded', () => {
    // Create ticket 5 hours ago for Gold (4 hour target)
    const ticket = createMockTicket({
      createdAt: new Date('2024-01-15T07:00:00Z'), // 5 hours ago = 300 minutes
    });
    const slaInfo = calculateTicketSLA(ticket, 'Gold');

    expect(slaInfo.firstResponse.elapsedMinutes).toBe(300);
    expect(slaInfo.firstResponse.status).toBe('breached');
  });

  it('should use default SLA level when not specified', () => {
    const ticket = createMockTicket();
    const slaInfo = calculateTicketSLA(ticket);

    expect(slaInfo.level).toBe(DEFAULT_SLA_LEVEL);
  });
});

describe('formatDuration', () => {
  it('should format minutes less than 60', () => {
    expect(formatDuration(30)).toBe('30m');
    expect(formatDuration(59)).toBe('59m');
  });

  it('should format hours without remaining minutes', () => {
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(180)).toBe('3h');
  });

  it('should format hours with remaining minutes', () => {
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(150)).toBe('2h 30m');
  });

  it('should format days without remaining hours', () => {
    expect(formatDuration(24 * 60)).toBe('1d');
    expect(formatDuration(48 * 60)).toBe('2d');
  });

  it('should format days with remaining hours', () => {
    expect(formatDuration(24 * 60 + 60)).toBe('1d 1h');
    expect(formatDuration(48 * 60 + 120)).toBe('2d 2h');
  });

  it('should return "Overdue" for negative values', () => {
    expect(formatDuration(-1)).toBe('Overdue');
    expect(formatDuration(-100)).toBe('Overdue');
  });

  it('should handle zero minutes', () => {
    expect(formatDuration(0)).toBe('0m');
  });
});

describe('getSLAStatusClass', () => {
  it('should return correct CSS class for within_sla', () => {
    expect(getSLAStatusClass('within_sla')).toBe('sla-within');
  });

  it('should return correct CSS class for at_risk', () => {
    expect(getSLAStatusClass('at_risk')).toBe('sla-at-risk');
  });

  it('should return correct CSS class for breached', () => {
    expect(getSLAStatusClass('breached')).toBe('sla-breached');
  });
});

describe('getSLAStatusLabel', () => {
  it('should return correct label for within_sla', () => {
    expect(getSLAStatusLabel('within_sla')).toBe('Within SLA');
  });

  it('should return correct label for at_risk', () => {
    expect(getSLAStatusLabel('at_risk')).toBe('At Risk');
  });

  it('should return correct label for breached', () => {
    expect(getSLAStatusLabel('breached')).toBe('Breached');
  });
});

describe('SLA_POLICIES', () => {
  it('should have Gold with correct targets', () => {
    expect(SLA_POLICIES.Gold.targets.urgent.firstResponseMinutes).toBe(4 * 60);
    expect(SLA_POLICIES.Gold.targets.urgent.resolutionMinutes).toBe(24 * 60);
  });

  it('should have Silver with correct targets', () => {
    expect(SLA_POLICIES.Silver.targets.normal.firstResponseMinutes).toBe(8 * 60);
    expect(SLA_POLICIES.Silver.targets.normal.resolutionMinutes).toBe(48 * 60);
  });

  it('should have Bronze with correct targets', () => {
    expect(SLA_POLICIES.Bronze.targets.low.firstResponseMinutes).toBe(16 * 60);
    expect(SLA_POLICIES.Bronze.targets.low.resolutionMinutes).toBe(72 * 60);
  });

  it('should have Gold as the fastest tier', () => {
    expect(SLA_POLICIES.Gold.targets.urgent.firstResponseMinutes).toBeLessThan(
      SLA_POLICIES.Silver.targets.urgent.firstResponseMinutes
    );
    expect(SLA_POLICIES.Silver.targets.urgent.firstResponseMinutes).toBeLessThan(
      SLA_POLICIES.Bronze.targets.urgent.firstResponseMinutes
    );
  });
});

describe('DEFAULT_SLA_LEVEL', () => {
  it('should be Bronze', () => {
    expect(DEFAULT_SLA_LEVEL).toBe('Bronze');
  });
});
