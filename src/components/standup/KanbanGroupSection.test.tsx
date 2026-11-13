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
/**
 * Highlight mode in the columns holding work in hand (#619, #659).
 *
 * To Do and Active are never faded and never reordered -- the stand-up reads
 * them aloud top to bottom. They are still ringed and badged: the count on the
 * Highlight button includes their cards, and for a while the board marked none
 * of them, so the number could not be accounted for (#659).
 *
 * Asserted on the rendered card rather than on `isInHandColumn`, because the
 * four behaviours used to come from one value and the bug was in splitting
 * them, not in naming the columns.
 */
describe('Highlight mode in To Do and Active', () => {
  function card(id: number, title: string) {
    return {
      id,
      title,
      state: 'Active',
      stateCategory: 'InProgress',
      workItemType: 'Task',
      project: 'Internal',
      devOpsUrl: '',
      tags: [],
      createdAt: '2026-10-10T09:00:00Z',
      updatedAt: '2026-10-10T09:00:00Z',
    };
  }

  // Item 2 sits above item 1 on purpose: item 1 is the highlighted one, so a
  // reorder would lift it and this order would not survive.
  const board: StandupColumn[] = [
    {
      name: 'Active',
      category: 'InProgress',
      items: [card(2, 'Quiet in hand'), card(1, 'Moved in hand')],
    },
    {
      name: 'Resolved',
      category: 'Resolved',
      items: [card(4, 'Quiet resolved'), card(3, 'Moved resolved')],
    },
  ];

  const activity = {
    summary: {
      pullRequests: { created: 0, updated: 0, merged: 0 },
      items: { created: 0, updated: 2, closed: 0 },
      highlights: new Map([
        [1, ['updated']],
        [3, ['updated']],
      ]),
      recent: new Set<number>(),
    },
    since: Date.parse('2026-10-15T12:00:00Z'),
    pullRequests: [],
    pullRequestState: 'ready',
  };

  function board_() {
    render(
      <KanbanGroupSection
        groupName="Internal"
        columns={board}
        focusedColumn="Active"
        activity={
          activity as unknown as React.ComponentProps<typeof KanbanGroupSection>['activity']
        }
      />
    );
  }

  /** The `.kanban-card` wrapper, which is what carries the ring and the fade. */
  function cardFor(title: string): HTMLElement {
    const element = screen.getByText(title).closest('.kanban-card');
    if (!(element instanceof HTMLElement)) throw new Error(`No card for ${title}`);
    return element;
  }

  it('rings and badges a card that moved, in hand as anywhere else', () => {
    board_();

    expect(cardFor('Moved in hand').style.boxShadow).toContain('2px');
    // The reason badge, which went with the ring.
    expect(screen.getAllByText('Updated')).toHaveLength(2);
  });

  it('does not fade the cards that did not move', () => {
    board_();

    expect(cardFor('Quiet in hand').style.opacity).toBe('');
  });

  it('still fades them in a column the stand-up skims past', () => {
    board_();

    expect(cardFor('Quiet resolved').style.opacity).toBe('0.35');
    expect(cardFor('Moved resolved').style.boxShadow).toContain('2px');
  });

  it('leaves the cards in hand where they were', () => {
    board_();

    const titles = [...document.querySelectorAll('.kanban-column')]
      .find((column) => column.textContent?.includes('Quiet in hand'))!
      .querySelectorAll('.kanban-card h4');
    expect([...titles].map((h) => h.textContent)).toEqual(['Quiet in hand', 'Moved in hand']);
  });

  it('lifts them in a column that is skimmed past (#503)', () => {
    board_();

    const titles = [...document.querySelectorAll('.kanban-column')]
      .find((column) => column.textContent?.includes('Quiet resolved'))!
      .querySelectorAll('.kanban-card h4');
    expect([...titles].map((h) => h.textContent)).toEqual(['Moved resolved', 'Quiet resolved']);
  });
});
