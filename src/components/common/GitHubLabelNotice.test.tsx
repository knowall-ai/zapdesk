// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import GitHubLabelNotice from './GitHubLabelNotice';

/**
 * The notice exists so an empty Tickets tab names the label it filtered on,
 * instead of passing for a broken GitHub connection (#607).
 */
afterEach(cleanup);

describe('GitHubLabelNotice', () => {
  it('names the label when issues were read but none carries it', () => {
    render(<GitHubLabelNotice summary={{ label: 'ticket', fetched: 20, labelled: 0 }} />);
    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain('None of the 20 GitHub issues found carries');
    expect(notice.textContent).toContain('the ticket label, so none are shown here');
    expect(notice.textContent).toContain('GITHUB_TICKET_LABEL');
    expect(screen.getByText('ticket').tagName).toBe('CODE');
  });

  it('names a configured label, not the default', () => {
    render(<GitHubLabelNotice summary={{ label: 'support', fetched: 3, labelled: 0 }} />);
    expect(screen.getByText('support').tagName).toBe('CODE');
  });

  it('reads naturally for a single issue', () => {
    render(<GitHubLabelNotice summary={{ label: 'ticket', fetched: 1, labelled: 0 }} />);
    expect(screen.getByRole('status').textContent).toContain(
      'The one GitHub issue found does not carry the ticket label'
    );
  });

  it('renders nothing when some issues carry the label', () => {
    const { container } = render(
      <GitHubLabelNotice summary={{ label: 'ticket', fetched: 20, labelled: 2 }} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when GitHub had no issues at all', () => {
    const { container } = render(
      <GitHubLabelNotice summary={{ label: 'ticket', fetched: 0, labelled: 0 }} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when GitHub was not read or failed', () => {
    // A failed read is reported by its own toast; blaming the label would mislead.
    const { container } = render(<GitHubLabelNotice summary={null} />);
    expect(container.firstChild).toBeNull();
  });
});
