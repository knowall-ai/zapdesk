// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { Ticket } from '@/types';

/**
 * Leaving a ticket's full page (7771).
 *
 * A ticket opened from an email has no recorded origin, and the browser's
 * history is not a usable stand-in: following the link signs the reader in,
 * and the sign-in redirects leave entries behind.
 */
const push = vi.fn();
const back = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back, replace: vi.fn() }),
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
    selectedOrganization: { name: 'KnowAll', id: 'org1' },
    setSelectedOrganization: () => {},
    isLoading: false,
    error: null,
    refetch: async () => {},
  }),
}));

import TicketDetail from './TicketDetail';

const ticket = {
  id: 7,
  workItemId: 7,
  title: 'Printer offline',
  description: '',
  status: 'open',
  devOpsState: 'Active',
  workItemType: 'Task',
  requester: {
    id: 'c1',
    displayName: 'Dana',
    email: 'dana@example.test',
    timezone: 'Europe/London',
    tags: [],
  },
  tags: ['ticket'],
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-02T00:00:00Z'),
  devOpsUrl: 'https://dev.azure.test/item/7',
  project: 'Internal',
  comments: [],
} as unknown as Ticket;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]', { status: 200 }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('leaving a ticket opened from outside the app', () => {
  it('goes to the ticket list, not back through the sign-in redirects', () => {
    // What an email link leaves behind: no `from` in the address, and a
    // history full of auth entries.
    window.history.pushState({}, '', '/tickets/7');
    window.history.pushState({}, '', '/tickets/7');
    expect(window.history.length).toBeGreaterThan(1);

    render(<TicketDetail ticket={ticket} comments={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));

    expect(push).toHaveBeenCalledWith('/tickets');
    expect(back).not.toHaveBeenCalled();
  });
});

describe('leaving a work item opened from a /tickets link', () => {
  const loadedAt = (url: string) =>
    vi
      .spyOn(performance, 'getEntriesByType')
      .mockImplementation((type: string) =>
        type === 'navigation' ? [{ name: url } as PerformanceEntry] : []
      );
  const workItem = { ...ticket, tags: [] } as unknown as Ticket;

  afterEach(() => vi.restoreAllMocks());

  it('goes to the Kanban board after the page moved itself to /workitems', () => {
    // An assignment email links to /tickets/<id>; the page replaces that with
    // /workitems/<id> as the item has no ticket tag. The tab has nothing in
    // the app to go back to.
    loadedAt(`${window.location.origin}/tickets/7`);
    window.history.replaceState({}, '', '/workitems/7');

    render(<TicketDetail ticket={workItem} comments={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));

    expect(push).toHaveBeenCalledWith('/kanban');
    expect(back).not.toHaveBeenCalled();
  });

  it('still goes back when it was opened from a page in the app', () => {
    loadedAt(`${window.location.origin}/dashboard`);
    window.history.replaceState({}, '', '/workitems/7');

    render(<TicketDetail ticket={workItem} comments={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));

    expect(back).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
