// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import WorkItemBoard, { TICKET_COLUMNS } from './WorkItemBoard';
import type { WorkItem } from '@/types';

// Filtering the list by customer (#7385). One Azure DevOps project is one
// customer -- its email domain comes from the project description, which is
// what routes that customer's mail into it -- so the project a ticket sits in
// is the customer it belongs to. The list already showed and sorted by it and
// offered no way to filter by it.

const item = (id: number, project: string, title: string): WorkItem => ({
  id,
  title,
  description: '',
  state: 'Active',
  workItemType: 'Bug',
  areaPath: project,
  project,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-02T00:00:00Z'),
  completedWork: 0,
  remainingWork: 0,
  originalEstimate: 0,
  devOpsUrl: `https://dev.azure.com/x/_workitems/edit/${id}`,
  tags: ['ticket'],
});

const ITEMS = [
  item(1, 'Contoso Ltd', 'Printer on fire'),
  item(2, 'Contoso Ltd', 'Cannot sign in'),
  item(3, 'ABC Inc', 'Mailbox full'),
];

const board = (items: WorkItem[] = ITEMS) =>
  render(
    <WorkItemBoard
      items={items}
      columns={TICKET_COLUMNS}
      hideTicketsOnlyToggle
      defaultTicketsOnly={false}
    />
  );

/** Open a filter dropdown by the label on its button. */
const openFilter = (label: string) => {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^(All )?${label}`) }));
};

describe('WorkItemBoard: filtering by customer (#7385)', () => {
  afterEach(cleanup);

  it('names the column Customer, because that is what a project is here', () => {
    board();
    expect(screen.getByRole('columnheader', { name: /Customer/ })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: /^Project/ })).toBeNull();
  });

  it('offers a customer filter listing each customer once', () => {
    board();
    openFilter('Customers');
    expect(screen.getByRole('checkbox', { name: 'ABC Inc' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Contoso Ltd' })).toBeTruthy();
  });

  it('shows only the chosen customer, and keeps the others out', () => {
    board();
    openFilter('Customers');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Contoso Ltd' }));

    expect(screen.getByText('Printer on fire')).toBeTruthy();
    expect(screen.getByText('Cannot sign in')).toBeTruthy();
    expect(screen.queryByText('Mailbox full')).toBeNull();
  });

  // A list already narrowed to one customer has nothing to offer.
  it('does not offer the filter when every ticket is the same customer', () => {
    board([item(1, 'Contoso Ltd', 'Printer on fire'), item(2, 'Contoso Ltd', 'Cannot sign in')]);
    expect(screen.queryByRole('button', { name: /Customers/ })).toBeNull();
  });

  // Clear all filters rebuilt the state from a hand-written list of every
  // filter, which did not include this one. It shows only when nothing
  // matches, so the search box is used here to empty the list while a
  // customer is chosen: before, clearing left the customer filter applied.
  it('clears the customer filter along with the rest', () => {
    board();
    openFilter('Customers');
    fireEvent.click(screen.getByRole('checkbox', { name: 'ABC Inc' }));
    fireEvent.change(screen.getByPlaceholderText('Search items...'), {
      target: { value: 'Printer' },
    });

    expect(screen.getByText('No items match your filters')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Clear all filters/i }));

    expect(screen.getByText('Mailbox full')).toBeTruthy();
    expect(screen.getByText('Printer on fire')).toBeTruthy();
    expect(screen.getByText('Cannot sign in')).toBeTruthy();
  });

  // The options came from every item while the rows came from the tickets,
  // so a project present only as a non-ticket offered a customer whose
  // every row was then filtered away.
  it('does not offer a customer that only a non-ticket item belongs to', () => {
    const nonTicket = { ...item(9, 'ABC Inc', 'Internal chore'), tags: [] };
    render(
      <WorkItemBoard
        items={[item(1, 'Contoso Ltd', 'Printer on fire'), nonTicket]}
        columns={TICKET_COLUMNS}
        hideTicketsOnlyToggle
        defaultTicketsOnly
      />
    );
    expect(screen.queryByRole('button', { name: /Customers/ })).toBeNull();
  });

  // Hiding the control while the filter still applies empties the board with
  // nothing on screen to say why -- and Kanban has no Clear all filters.
  it('keeps a chosen customer on offer after it leaves the list', () => {
    const { rerender } = board();
    openFilter('Customers');
    fireEvent.click(screen.getByRole('checkbox', { name: 'ABC Inc' }));

    rerender(
      <WorkItemBoard
        items={[item(1, 'Contoso Ltd', 'Printer on fire')]}
        columns={TICKET_COLUMNS}
        hideTicketsOnlyToggle
        defaultTicketsOnly={false}
      />
    );

    // The control is still there, and still says one customer is chosen.
    expect(screen.getByRole('button', { name: /Customers \(1\)/ })).toBeTruthy();
    // The dropdown is still open from above, so the choice is reachable.
    const chosen = screen.getByRole('checkbox', { name: 'ABC Inc' }) as HTMLInputElement;
    expect(chosen.checked).toBe(true);

    fireEvent.click(chosen);
    expect(screen.getByText('Printer on fire')).toBeTruthy();
  });
});
