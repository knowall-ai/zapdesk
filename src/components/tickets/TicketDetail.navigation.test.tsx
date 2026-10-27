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
