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
});
