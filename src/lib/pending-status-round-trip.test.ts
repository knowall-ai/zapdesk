import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setStateCategoryCache, workItemToTicket } from './devops';
import {
  PENDING_STATE_HINTS,
  isPendingStateName,
  resolveStateForStatus,
  type WorkItemStateDef,
} from './state-categories';
import type { DevOpsWorkItem, TicketStatus } from '@/types';

/**
 * Setting a ticket to Pending and reading it back.
 *
 * The two halves disagreed. Writing `Pending` resolves to a state named
 * blocked/pending/on hold/waiting (the #297 mapping). Reading went by state
 * *category*, and Blocked shares the InProgress category with Active — so
 * every blocked ticket came back as `In Progress`, including the ones ZapDesk
 * had just set to Pending.
 *
 * Measured on the live org before the fix: 20 work items in KnowAll were in
 * the Blocked state, every one of them showing as In Progress, with the
 * Pending count reading zero and the Pending view empty.
 */

// The states the Internal process template really defines for a Task.
const TASK_STATES: WorkItemStateDef[] = [
  { name: 'New', category: 'Proposed' },
  { name: 'Todo', category: 'Proposed' },
  { name: 'Active', category: 'InProgress' },
  { name: 'Blocked', category: 'InProgress' },
  { name: 'Closed', category: 'Completed' },
  { name: 'Removed', category: 'Removed' },
];

/**
 * In production the category cache is populated from the org's real state
 * definitions, and Blocked's category is InProgress. Populating it here is
 * what makes these tests able to tell "checked before the category" from
 * "checked after it" -- with an empty cache the category branch never runs and
 * the ordering that caused the bug is invisible.
 */
beforeEach(() => {
  setStateCategoryCache(Object.fromEntries(TASK_STATES.map((s) => [s.name, s.category])));
});

afterEach(() => {
  setStateCategoryCache({});
});

const ticketInState = (state: string): TicketStatus =>
  workItemToTicket({
    id: 1,
    fields: {
      'System.Title': 'Printer on the second floor is jamming',
      'System.State': state,
      'System.WorkItemType': 'Task',
      'System.TeamProject': 'Internal',
      'System.CreatedBy': {
        id: 'u1',
        displayName: 'Riley Quinn',
        uniqueName: 'riley@example.test',
      },
      'System.CreatedDate': '2026-10-01T00:00:00Z',
      'System.ChangedDate': '2026-10-02T00:00:00Z',
    },
  } as unknown as DevOpsWorkItem).status;

describe('a ticket set to Pending reads back as Pending', () => {
  it('survives the round trip through the state Azure DevOps actually stores', () => {
    // The property that was broken. Writing and reading must agree, whatever
    // the template happens to call the state.
    const written = resolveStateForStatus('Pending', TASK_STATES);
    expect(written).toBe('Blocked');
    expect(ticketInState(written!)).toBe('Pending');
  });

  it('reads Blocked as Pending rather than In Progress', () => {
    expect(ticketInState('Blocked')).toBe('Pending');
  });

  it('round-trips through every name the write side is willing to choose', () => {
    // resolveStateForStatus picks whichever of these a template defines, so
    // reading has to recognise all of them, not just Blocked.
    for (const hint of PENDING_STATE_HINTS) {
      const states: WorkItemStateDef[] = [
        { name: 'Active', category: 'InProgress' },
        { name: hint, category: 'InProgress' },
      ];
      const written = resolveStateForStatus('Pending', states);
      expect(written, `no state chosen for "${hint}"`).toBe(hint);
      expect(ticketInState(written!), `"${hint}" did not read back as Pending`).toBe('Pending');
    }
  });

  it('matches the state name however the template spells it', () => {
    // "On Hold" and "ON HOLD" are the same state to a reader.
    expect(ticketInState('On Hold')).toBe('Pending');
    expect(ticketInState('BLOCKED')).toBe('Pending');
    expect(ticketInState('Waiting')).toBe('Pending');
  });
});

describe('the other statuses are unchanged', () => {
  // The fix sits in front of the category mapping, so it could have swallowed
  // states that should not be Pending.
  it.each([
    ['New', 'New'],
    // Active and Blocked share the InProgress category; only the name tells
    // them apart, which is the whole point of the fix.
    ['Active', 'In Progress'],
    ['Todo', 'New'],
    ['Closed', 'Closed'],
    ['Removed', 'Closed'],
    // Not in this template at all, so it falls through to the name fallback.
    ['Done', 'Closed'],
  ] as const)('reads %s as %s', (state, expected) => {
    expect(ticketInState(state)).toBe(expected);
  });

  it('does not treat a state that merely contains a hint as Pending', () => {
    // "Unblocked" is being worked on, not waiting.
    expect(isPendingStateName('Unblocked')).toBe(false);
    expect(isPendingStateName('Pending review')).toBe(false);
  });
});
