// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { StandupColumn } from '@/types';

/**
 * The group board on the Kanban page.
 *
 * `globals.css` styles it through `.kanban-group`: that selector is what makes
 * the state columns sit flush and share their borders (#305). The class is a
 * contract between the stylesheet and this component, and nothing else checks
 * it -- a rendered class name is invisible to the type checker, the build and
 * every other test -- so it is asserted here.
 */
vi.mock('@/components/providers/OrganizationProvider', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
  useOrganization: () => ({
    organizations: [],
    selectedOrganization: { name: 'KnowAll', id: 'org1' },
    setSelectedOrganization: () => {},
    isLoading: false,
    error: null,
    refetch: async () => {},
  }),
}));

import KanbanGroupSection from './KanbanGroupSection';

const columns: StandupColumn[] = [
  { name: 'Active', category: 'InProgress', items: [] },
  { name: 'Resolved', category: 'Resolved', items: [] },
];

afterEach(cleanup);

describe('KanbanGroupSection', () => {
  it('carries the class its stylesheet targets', () => {
    const { container } = render(<KanbanGroupSection groupName="Internal" columns={columns} />);

    expect(container.querySelector('.kanban-group')).not.toBeNull();
  });

  it('names the group', () => {
    render(<KanbanGroupSection groupName="Internal" columns={columns} />);

    expect(screen.getByText('Internal')).toBeDefined();
  });
});

/**
 * The hint beside the Closed column heading, which has to follow the board's
 * closed window (#6713).
 *
 * It is the kind of label that goes stale unnoticed: it said "the last 7 days"
 * while the window was being made selectable, and nothing but a reader would
 * have caught it. `focusedColumn` is passed to open the group, because a
 * collapsed one renders no columns at all.
 */
describe('the Closed column hint', () => {
  // A card is needed as well as an open group: a group with no items at all
  // renders no columns, so it would have no hint to assert against.
  const withClosed: StandupColumn[] = [
    { name: 'Active', category: 'InProgress', items: [] },
    {
      name: 'Closed',
      category: 'Completed',
      items: [
        {
          id: 1,
          title: 'Reset a password',
          state: 'Closed',
          workItemType: 'Task',
          project: 'Internal',
        },
      ] as unknown as StandupColumn['items'],
    },
  ];

  it('names the bounded span by default', () => {
    render(<KanbanGroupSection groupName="Internal" columns={withClosed} focusedColumn="Closed" />);

    expect(screen.getByLabelText('Showing items closed in the last 14 days')).toBeDefined();
  });

  it('says every closed item when the board shows the whole history', () => {
    render(
      <KanbanGroupSection
        groupName="Internal"
        columns={withClosed}
        focusedColumn="Closed"
        closedWindow="all"
      />
    );

    // Not "every closed item": GitHub closed-issue reads are page-capped, so
    // the hint must not promise more than the fetch can deliver (#603 review).
    expect(screen.getByLabelText(/as far back as they go/)).toBeDefined();
    expect(screen.queryByLabelText(/every closed item/)).toBeNull();
    // The fixed span must be gone, not merely joined by the new wording.
    expect(screen.queryByLabelText(/last 14 days/)).toBeNull();
  });

  // It is measured on the closed date now, so the hint must not promise that
  // it is about when an item last changed.
  it('does not describe the window as the last change', () => {
    render(<KanbanGroupSection groupName="Internal" columns={withClosed} focusedColumn="Closed" />);

    expect(screen.queryByLabelText(/changed in the last/)).toBeNull();
  });
});
