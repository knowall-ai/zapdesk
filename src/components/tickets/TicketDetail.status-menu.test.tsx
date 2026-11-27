// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import type { Ticket } from '@/types';

/**
 * The ticket screen's status menu offers only the states this work item's
 * type has (#725). It used to list every state of the four default types in
 * the first project, so a Task with no Resolved state was still offered
 * Resolved, and choosing it changed nothing.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tickets/7',
}));

vi.mock('@/hooks/useMentionableUsers', () => ({
  useMentionableUsers: () => ({ users: [], loading: false }),
}));

vi.mock('@/components/providers/OrganizationProvider', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
  useOrganization: () => ({
    organizations: [],
    selectedOrganization: { name: 'Contoso', accountName: 'Contoso', id: 'org1' },
    setSelectedOrganization: () => {},
    isLoading: false,
    error: null,
    refetch: async () => {},
  }),
}));

import TicketDetail from './TicketDetail';

const state = (name: string, category: string) => ({ name, color: '888888', category });

/** A Task in this process has no Resolved state. */
const TASK_STATES = [
  state('New', 'Proposed'),
  state('Todo', 'Proposed'),
  state('Active', 'InProgress'),
  state('Blocked', 'InProgress'),
  state('Pending', 'InProgress'),
  state('Closed', 'Completed'),
  state('Removed', 'Removed'),
];

/** What the route answers with no type: every default type's states together. */
const ALL_STATES = [...TASK_STATES.slice(0, 5), state('Resolved', 'Resolved'), TASK_STATES[5]];

const ticket = (overrides: Partial<Ticket> = {}): Ticket =>
  ({
    id: 7,
    workItemId: 7,
    title: 'Printer offline',
    description: '',
    status: 'open',
    devOpsState: 'Active',
    workItemType: 'Task',
    requester: {
      id: 'c1',
      displayName: 'Alex Morgan',
      email: 'alex@example.com',
      timezone: 'Europe/London',
      tags: [],
    },
    tags: ['ticket'],
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-02T00:00:00Z'),
    devOpsUrl: 'https://dev.azure.test/item/7',
    project: 'Contoso',
    comments: [],
    ...overrides,
  }) as unknown as Ticket;

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input), 'https://zapdesk.test');
  if (url.pathname === '/api/devops/workitem-states') {
    const states = url.searchParams.get('type') === 'Task' ? TASK_STATES : ALL_STATES;
    return new Response(JSON.stringify({ allStates: states }), { status: 200 });
  }
  if (url.pathname.endsWith('/state-requirements')) {
    return new Response(JSON.stringify({ fields: [] }), { status: 200 });
  }
  return new Response('[]', { status: 200 });
});

const stateButton = () => screen.getByText('Active', { selector: 'span' }).closest('button')!;

/** The open menu: the panel holding the state options. */
const menu = async () => {
  const option = await screen.findByRole('button', { name: 'Closed' });
  return option.parentElement as HTMLElement;
};

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TicketDetail status menu', () => {
  it("offers only the states of the ticket's own work item type", async () => {
    render(<TicketDetail ticket={ticket()} comments={[]} onStateChange={async () => {}} />);
    fireEvent.click(stateButton());

    const options = within(await menu())
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(options).toEqual(TASK_STATES.map((s) => s.name));
    expect(options).not.toContain('Resolved');

    const statesCall = fetchMock.mock.calls
      .map(([input]) => new URL(String(input), 'https://zapdesk.test'))
      .find((url) => url.pathname === '/api/devops/workitem-states');
    expect(statesCall?.searchParams.get('type')).toBe('Task');
    expect(statesCall?.searchParams.get('project')).toBe('Contoso');
  });

  it('closes the menu when the change is refused, leaving the message to the page', async () => {
    // The page reports the refusal itself (a toast); the menu must not be left
    // open over it as if nothing had happened.
    const onStateChange = vi.fn(async () => {
      throw new Error('The "Closed" state is not available for the Task work item type.');
    });
    render(<TicketDetail ticket={ticket()} comments={[]} onStateChange={onStateChange} />);
    fireEvent.click(stateButton());
    fireEvent.click(within(await menu()).getByRole('button', { name: 'Closed' }));

    await waitFor(() => expect(onStateChange).toHaveBeenCalledWith('Closed'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Closed' })).toBeNull());
    // Usable again for another try.
    expect(stateButton().disabled).toBe(false);
  });
});
