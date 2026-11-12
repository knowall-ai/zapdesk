import { describe, it, expect } from 'vitest';
import { gitHubLabelState, readGitHubLabelSummary } from './github-label-notice';

// An empty Tickets tab has three causes that looked the same (#607): GitHub
// could not be read, it had no issues, or no issue carries the ticket label.
describe('gitHubLabelState', () => {
  it('is unknown when GitHub was not read, or the read failed', () => {
    expect(gitHubLabelState(null)).toBe('unknown');
    expect(gitHubLabelState(undefined)).toBe('unknown');
  });

  it('is no-issues when GitHub answered with nothing', () => {
    expect(gitHubLabelState({ label: 'ticket', fetched: 0, labelled: 0 })).toBe('no-issues');
  });

  it('is none-labelled when issues were read but none carries the label', () => {
    expect(gitHubLabelState({ label: 'ticket', fetched: 12, labelled: 0 })).toBe('none-labelled');
  });

  it('is labelled when some issues carry the label', () => {
    expect(gitHubLabelState({ label: 'ticket', fetched: 12, labelled: 3 })).toBe('labelled');
  });
});

describe('readGitHubLabelSummary', () => {
  it('reads the summary the route sends', () => {
    expect(
      readGitHubLabelSummary({
        tickets: [],
        ticketLabel: 'support',
        fetchedCount: 4,
        labelledCount: 0,
      })
    ).toEqual({ label: 'support', fetched: 4, labelled: 0 });
  });

  it('is null for an answer without one, such as "not configured"', () => {
    expect(readGitHubLabelSummary({ configured: false, tickets: [] })).toBeNull();
    expect(readGitHubLabelSummary(null)).toBeNull();
    expect(readGitHubLabelSummary('nope')).toBeNull();
  });

  it('is null for malformed fields rather than guessing', () => {
    expect(
      readGitHubLabelSummary({ ticketLabel: '', fetchedCount: 1, labelledCount: 0 })
    ).toBeNull();
    expect(
      readGitHubLabelSummary({ ticketLabel: 'ticket', fetchedCount: '1', labelledCount: 0 })
    ).toBeNull();
  });

  // The counts cover what was read. If a repository failed or an organization
  // was read only in part, the labelled issues may be among the missing ones,
  // so "none carries the label" is not a conclusion the evidence supports --
  // and it is the persistent notice, while the partial read is only a toast
  // (raised in review on #644).
  it('is null when a repository could not be read', () => {
    expect(
      readGitHubLabelSummary({
        ticketLabel: 'ticket',
        fetchedCount: 4,
        labelledCount: 0,
        failedRepos: ['owner/private-repo'],
      })
    ).toBeNull();
  });

  it('is null when an organization was read only in part', () => {
    expect(
      readGitHubLabelSummary({
        ticketLabel: 'ticket',
        fetchedCount: 1000,
        labelledCount: 0,
        truncatedRepos: ['owner/*'],
      })
    ).toBeNull();
  });

  it('still reads the summary when the read was complete', () => {
    expect(
      readGitHubLabelSummary({
        ticketLabel: 'ticket',
        fetchedCount: 4,
        labelledCount: 0,
        failedRepos: [],
        truncatedRepos: [],
      })
    ).toEqual({ label: 'ticket', fetched: 4, labelled: 0 });
  });
});
