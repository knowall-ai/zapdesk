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

/** A type in another process: no Active state at all. */
const ISSUE_STATES = [
  state('To Do', 'Proposed'),
  state('Doing', 'InProgress'),
  state('Done', 'Completed'),
];

/** Each type's states, as the route would answer for `?type=`. */
let statesByType: Record<string, ReturnType<typeof state>[] | 'error'> = {};

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input), 'https://zapdesk.test');
  if (url.pathname === '/api/devops/workitem-states') {
    const type = url.searchParams.get('type');
    if (!type) return new Response(JSON.stringify({ allStates: ALL_STATES }), { status: 200 });
    const states = statesByType[type];
    if (!states || states === 'error') {
      return new Response(JSON.stringify({ error: 'Could not read the states' }), { status: 502 });
    }
    return new Response(JSON.stringify({ allStates: states }), { status: 200 });
  }
  if (url.pathname.endsWith('/state-requirements')) {
    return new Response(JSON.stringify({ fields: [] }), { status: 200 });
  }
  return new Response('[]', { status: 200 });
});

const statesCalls = () =>
  fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'https://zapdesk.test'))
    .filter((url) => url.pathname === '/api/devops/workitem-states');

const stateButton = (current = 'Active') =>
  screen.getByText(current, { selector: 'span' }).closest('button')!;

/** The open menu: the panel holding the state options. */
const menu = async (option_ = 'Closed') => {
  const option = await screen.findByRole('button', { name: option_ });
  return option.parentElement as HTMLElement;
};

beforeEach(() => {
  fetchMock.mockClear();
  statesByType = { Task: TASK_STATES, Issue: ISSUE_STATES };
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

    const statesCall = statesCalls()[0];
    expect(statesCall?.searchParams.get('type')).toBe('Task');
    expect(statesCall?.searchParams.get('project')).toBe('Contoso');
  });

  it('closes the menu and frees the button when the change is refused', async () => {
    // What the user reads is the page's toast (src/app/tickets/[id]/page.tsx);
    // this only proves the menu is not left open as if nothing had happened.
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

  // A fallback once added Active to every list. For a type that has no Active
  // state that is the same bug as Resolved on a Task (#725).
  it('a type with no Active state is not offered Active', async () => {
    render(
      <TicketDetail
        ticket={ticket({ workItemType: 'Issue', devOpsState: 'To Do' })}
        comments={[]}
        onStateChange={async () => {}}
      />
    );
    fireEvent.click(stateButton('To Do'));

    const options = within(await menu('Done'))
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(options).toEqual(['To Do', 'Doing', 'Done']);
  });

  it('an empty or failed answer offers nothing and is asked for again on reopen', async () => {
    statesByType = { Task: 'error' };
    render(<TicketDetail ticket={ticket()} comments={[]} onStateChange={async () => {}} />);
    fireEvent.click(stateButton());

    expect(await screen.findByText('Could not load statuses')).toBeTruthy();
    // Only the menu's own button reads Active: no lone made-up option.
    expect(screen.getAllByRole('button', { name: 'Active' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Closed' })).toBeNull();
    expect(statesCalls()).toHaveLength(1);

    // Closed and opened again: asked again, and this time it answers.
    statesByType = { Task: TASK_STATES };
    fireEvent.click(stateButton());
    fireEvent.click(stateButton());
    await menu();
    expect(statesCalls()).toHaveLength(2);
    expect(screen.queryByText('Could not load statuses')).toBeNull();

    // An answer with no states is treated the same way.
    cleanup();
    fetchMock.mockClear();
    statesByType = { Task: [] };
    render(<TicketDetail ticket={ticket()} comments={[]} onStateChange={async () => {}} />);
    fireEvent.click(stateButton());
    expect(await screen.findByText('Could not load statuses')).toBeTruthy();
    // Only the menu's own button reads Active: no lone made-up option.
    expect(screen.getAllByRole('button', { name: 'Active' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Closed' })).toBeNull();
  });

  it("ignores a late answer for the ticket's previous type", async () => {
    let answerTask: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (answerTask = resolve))
    );
    const { rerender } = render(
      <TicketDetail ticket={ticket()} comments={[]} onStateChange={async () => {}} />
    );
    fireEvent.click(stateButton());
    await waitFor(() => expect(statesCalls()).toHaveLength(1));

    // The type changes while the Task request is still out.
    rerender(
      <TicketDetail
        ticket={ticket({ workItemType: 'Issue', devOpsState: 'To Do' })}
        comments={[]}
        onStateChange={async () => {}}
      />
    );
    await menu('Done');
    expect(statesCalls().map((url) => url.searchParams.get('type'))).toEqual(['Task', 'Issue']);

    answerTask(new Response(JSON.stringify({ allStates: TASK_STATES }), { status: 200 }));
    await new Promise((r) => setTimeout(r, 0));
    const options = within(await menu('Done'))
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(options).toEqual(['To Do', 'Doing', 'Done']);
  });
});
