import { describe, it, expect } from 'vitest';
import { supportTicketConfig, SUPPORT_TICKET_STATES } from './support-ticket';
import { getTemplateConfig, isTemplateSupported, getSupportedTemplates } from './index';
import { resolveStateForStatus, statusNamedByState } from '@/lib/state-categories';
import { DEFAULT_PAUSING_STATES } from '@/lib/sla-clock';
import type { TicketStatus } from '@/types';

/**
 * The Support Ticket process template (#569).
 *
 * Every other template here was built for development work, so ZapDesk had
 * to translate by state category -- and `Open` and `In Progress` are the same
 * category, so one of them was always a guess. On this template the state is
 * the status, and these are the checks that it stays that way.
 */

const states = SUPPORT_TICKET_STATES.map((s) => ({ name: s.name, category: s.category }));

describe('the template is registered', () => {
  it('is found by name, however it is typed', () => {
    expect(getTemplateConfig('Support Ticket').id).toBe('support-ticket');
    expect(getTemplateConfig('support-ticket').id).toBe('support-ticket');
    expect(isTemplateSupported('Support Ticket')).toBe(true);
  });

  it('is offered beside the others, so a project on it is not warned about', () => {
    expect(getSupportedTemplates()).toContain('Support Ticket');
  });

  it('creates tickets as Ticket, in New', () => {
    expect(supportTicketConfig.workItemTypes.defaultTicketType).toBe('Ticket');
    expect(supportTicketConfig.defaultState).toBe('New');
  });
});

describe('status and state are the same thing here', () => {
  const roundTrip: TicketStatus[] = ['New', 'Open', 'In Progress', 'Pending', 'Closed'];

  it.each(roundTrip)('writes %s as itself, and reads it back as itself', (status) => {
    const written = resolveStateForStatus(status, states);

    expect(written).toBe(status);
    expect(statusNamedByState(written!)).toBe(status);
  });

  it('tells Open and In Progress apart', () => {
    // Both are InProgress to DevOps. Reading by category alone turned one of
    // them into the other, which is the bug this template removes.
    expect(statusNamedByState('Open')).toBe('Open');
    expect(statusNamedByState('In Progress')).toBe('In Progress');
  });

  it('writes Pending as Pending, not as Blocked', () => {
    // On a development template Pending is written as Blocked and read back
    // out of it. Here there is a state that means what it says.
    expect(resolveStateForStatus('Pending', states)).toBe('Pending');
  });

  it('does not read a status out of a state merely named like one', () => {
    expect(statusNamedByState('Pending Review')).toBeNull();
    expect(statusNamedByState('Reopened')).toBeNull();
    expect(statusNamedByState('Doing')).toBeNull();
  });

  it('ignores the spacing and casing a state name is spelled with', () => {
    expect(statusNamedByState('in progress')).toBe('In Progress');
    expect(statusNamedByState('In-Progress')).toBe('In Progress');
  });
});

describe('the SLA clock', () => {
  it('stops on the state that means waiting on somebody else', () => {
    const pausing = SUPPORT_TICKET_STATES.filter((s) => s.slaClock === 'paused');

    expect(pausing.map((s) => s.name)).toEqual(['Pending']);
    for (const state of pausing) {
      expect(DEFAULT_PAUSING_STATES).toContain(state.name.toLowerCase());
    }
  });

  it('keeps running on every state that is the team to move', () => {
    const running = SUPPORT_TICKET_STATES.filter((s) => s.slaClock === 'running');

    expect(running.map((s) => s.name)).toEqual(['New', 'Open', 'In Progress']);
    for (const state of running) {
      expect(DEFAULT_PAUSING_STATES).not.toContain(state.name.toLowerCase());
    }
  });
});

describe('the state list and the config agree', () => {
  // Two lists of the same states is two places to be wrong. They are kept
  // apart because one describes the process and the other is what ZapDesk's
  // admin page reads, so this is the check that they stay in step.
  it('puts every state in the config under its category', () => {
    const named = new Set([
      ...supportTicketConfig.states.new,
      ...supportTicketConfig.states.active,
      ...supportTicketConfig.states.resolved,
      ...supportTicketConfig.states.closed,
    ]);

    for (const state of SUPPORT_TICKET_STATES) {
      expect(named).toContain(state.name);
    }
  });

  it('has no Resolved state, and says so rather than leaving a gap', () => {
    // A support desk closes a ticket when the customer is satisfied; a
    // separate Resolved is the state nobody moves out of.
    expect(supportTicketConfig.states.resolved).toEqual([]);
    expect(SUPPORT_TICKET_STATES.some((s) => s.name === 'Resolved')).toBe(false);
  });
});
