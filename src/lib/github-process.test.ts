import { describe, it, expect } from 'vitest';
import {
  GITHUB_MANAGED_LABELS,
  GITHUB_STATES,
  gitHubLabelsAfterStatus,
  gitHubStateCategory,
  gitHubStatusFor,
  gitHubWriteForStatus,
} from './github-process';
import type { TicketStatus } from '@/types';

/**
 * The GitHub process template (#567).
 *
 * GitHub has no process: an issue is open or closed. Everything between --
 * triaged, being worked on, waiting on the customer -- has to be carried in
 * labels, and read back out of them.
 */

describe('gitHubStatusFor', () => {
  it('calls an open, unassigned, unlabelled issue New', () => {
    expect(gitHubStatusFor({ state: 'open' })).toBe('New');
  });

  it('calls an assigned issue Open: somebody has picked it up', () => {
    expect(gitHubStatusFor({ state: 'open', hasAssignee: true })).toBe('Open');
  });

  it('reads In Progress and Pending out of the labels', () => {
    expect(gitHubStatusFor({ state: 'open', labels: ['status: in progress'] })).toBe('In Progress');
    expect(gitHubStatusFor({ state: 'open', labels: ['status: pending'] })).toBe('Pending');
  });

  it('accepts the blocked label repositories already use for Pending', () => {
    expect(gitHubStatusFor({ state: 'open', labels: ['blocked'] })).toBe('Pending');
  });

  it('ignores the casing and spacing a label was typed with', () => {
    expect(gitHubStatusFor({ state: 'open', labels: ['Status:  In  Progress'] })).toBe(
      'In Progress'
    );
    expect(gitHubStatusFor({ state: 'open', labels: ['status: in-progress'] })).toBe('In Progress');
  });

  it('lets a label beat the assignee', () => {
    // Assigning somebody does not undo "waiting on the customer".
    expect(gitHubStatusFor({ state: 'open', labels: ['status: pending'], hasAssignee: true })).toBe(
      'Pending'
    );
  });

  it('takes the furthest along when stale labels are left behind', () => {
    // Labels accumulate: somebody adds the new one and forgets the old.
    expect(
      gitHubStatusFor({ state: 'open', labels: ['status: open', 'status: in progress'] })
    ).toBe('In Progress');
    expect(
      gitHubStatusFor({ state: 'open', labels: ['status: in progress', 'status: pending'] })
    ).toBe('Pending');
  });

  it('ignores labels that are not this template’s', () => {
    expect(gitHubStatusFor({ state: 'open', labels: ['bug', 'ticket', 'good first issue'] })).toBe(
      'New'
    );
  });

  it('calls a closed issue Closed, however it was closed', () => {
    expect(gitHubStatusFor({ state: 'closed', stateReason: 'completed' })).toBe('Closed');
    expect(gitHubStatusFor({ state: 'closed', stateReason: 'not_planned' })).toBe('Closed');
    expect(gitHubStatusFor({ state: 'CLOSED' })).toBe('Closed');
  });

  it('calls a closed issue Resolved only when it is labelled so', () => {
    expect(gitHubStatusFor({ state: 'closed', labels: ['status: resolved'] })).toBe('Resolved');
  });

  it('does not let an open issue read as Resolved', () => {
    // The label alone is not enough: Resolved means the issue is closed.
    expect(gitHubStatusFor({ state: 'open', labels: ['status: resolved'] })).toBe('New');
  });
});

describe('gitHubWriteForStatus', () => {
  it('closes for Resolved and Closed, and opens for everything else', () => {
    expect(gitHubWriteForStatus('Closed').state).toBe('closed');
    expect(gitHubWriteForStatus('Resolved').state).toBe('closed');
    for (const status of ['New', 'Open', 'In Progress', 'Pending'] as TicketStatus[]) {
      expect(gitHubWriteForStatus(status).state).toBe('open');
    }
  });

  it('sets a close reason only when closing', () => {
    // GitHub rejects state_reason on an issue being opened.
    expect(gitHubWriteForStatus('Closed').stateReason).toBe('completed');
    expect(gitHubWriteForStatus('In Progress').stateReason).toBeUndefined();
  });

  it('writes the label the status needs, and no label where the state says it', () => {
    expect(gitHubWriteForStatus('Pending').addLabel).toBe('status: pending');
    expect(gitHubWriteForStatus('Resolved').addLabel).toBe('status: resolved');
    // New is an open issue nobody has picked up; Closed is simply closed.
    expect(gitHubWriteForStatus('New').addLabel).toBeUndefined();
    expect(gitHubWriteForStatus('Closed').addLabel).toBeUndefined();
  });

  it('takes off the other status labels, so two cannot disagree', () => {
    const write = gitHubWriteForStatus('In Progress');

    expect(write.removeLabels).toContain('status: open');
    expect(write.removeLabels).toContain('status: pending');
    expect(write.removeLabels).not.toContain('status: in progress');
  });
});

describe('gitHubLabelsAfterStatus', () => {
  it('leaves the repository’s own labels alone', () => {
    expect(gitHubLabelsAfterStatus(['bug', 'ticket'], 'Pending')).toEqual([
      'bug',
      'ticket',
      'status: pending',
    ]);
  });

  it('replaces the previous status label rather than stacking another on', () => {
    expect(gitHubLabelsAfterStatus(['ticket', 'status: open'], 'In Progress')).toEqual([
      'ticket',
      'status: in progress',
    ]);
  });

  it('clears every status label for a status that needs none', () => {
    expect(gitHubLabelsAfterStatus(['ticket', 'status: in progress', 'blocked'], 'New')).toEqual([
      'ticket',
    ]);
  });

  it('does not add a label the issue already carries', () => {
    expect(gitHubLabelsAfterStatus(['Status: Pending'], 'Pending')).toEqual(['Status: Pending']);
  });
});

describe('the template itself', () => {
  it('round-trips every status it can write', () => {
    // Everything ZapDesk can set must read back as what was set, or a status
    // change would appear to do nothing -- or something else.
    for (const status of [
      'New',
      'Open',
      'In Progress',
      'Pending',
      'Resolved',
      'Closed',
    ] as TicketStatus[]) {
      const write = gitHubWriteForStatus(status);
      const labels = gitHubLabelsAfterStatus(['ticket'], status);

      expect(
        gitHubStatusFor({
          state: write.state,
          stateReason: write.stateReason,
          labels,
          // Open is the one status that can also be reached by assigning
          // somebody, so it is the only one where this matters.
          hasAssignee: status === 'Open',
        })
      ).toBe(status);
    }
  });

  it('gives every state a category the Kanban columns understand', () => {
    expect(GITHUB_STATES.map((s) => s.name)).toEqual([
      'New',
      'Open',
      'In Progress',
      'Pending',
      'Resolved',
      'Closed',
    ]);
    expect(gitHubStateCategory('New')).toBe('Proposed');
    expect(gitHubStateCategory('Pending')).toBe('InProgress');
    expect(gitHubStateCategory('Resolved')).toBe('Resolved');
    expect(gitHubStateCategory('Closed')).toBe('Completed');
  });

  it('treats a state it does not know as Proposed rather than guessing', () => {
    expect(gitHubStateCategory('Whatever')).toBe('Proposed');
  });

  it('manages only its own labels', () => {
    expect(GITHUB_MANAGED_LABELS).not.toContain('bug');
    expect(GITHUB_MANAGED_LABELS).toContain('blocked');
  });
});
