// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ApprovalDetails from './ApprovalDetails';

const approver = { id: 'a1', displayName: 'Alex Morgan', email: 'alex@example.com' };

afterEach(() => {
  cleanup();
});

describe('ApprovalDetails', () => {
  it('shows who approved the item, and when', () => {
    render(
      <ApprovalDetails approvedBy={approver} approvedDate={new Date(Date.UTC(2026, 10, 18))} />
    );

    expect(screen.getByText('Approved By')).toBeTruthy();
    expect(screen.getByText('Alex Morgan')).toBeTruthy();
    expect(screen.getByText('alex@example.com')).toBeTruthy();
    expect(screen.getByText('Approved Date')).toBeTruthy();
    expect(screen.getByText('18 Nov 2026')).toBeTruthy();
  });

  // Over JSON the date arrives as a string, and not every page revives it.
  it('accepts the date as the string an API response carries', () => {
    render(<ApprovalDetails approvedDate="2026-11-18T12:00:00Z" />);

    expect(screen.getByText('18 Nov 2026')).toBeTruthy();
    expect(screen.queryByText('Approved By')).toBeNull();
  });

  // The form writes a day, which DevOps keeps as midnight UTC. Whatever the
  // viewer's zone, that is the day shown -- not the day before, west of UTC.
  it("shows the stored calendar day whatever the viewer's time zone", () => {
    const { rerender } = render(<ApprovalDetails approvedDate="2026-11-18T00:00:00Z" />);
    expect(screen.getByText('18 Nov 2026')).toBeTruthy();

    rerender(<ApprovalDetails approvedDate="2026-11-18T23:59:00Z" />);
    expect(screen.getByText('18 Nov 2026')).toBeTruthy();
  });

  it('shows nothing for an item with no approval', () => {
    const { container } = render(<ApprovalDetails />);

    expect(container.innerHTML).toBe('');
  });

  it('leaves out a date that is not a date', () => {
    const { container } = render(<ApprovalDetails approvedDate="not a date" />);

    expect(container.innerHTML).toBe('');
  });
});
