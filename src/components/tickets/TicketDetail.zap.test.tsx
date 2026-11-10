// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { Ticket } from '@/types';

/**
 * Whether the zap dialog offers a message where the page can post one (#330,
 * #615 review).
 *
 * The dialog only offers the field when it is given a way to post the comment,
 * because a message nobody writes down is worse than no field at all. That
 * check was defeated by the wrapper this page passed: a function is always
 * truthy, so the dialog believed there was somewhere to post even when
 * `onAddComment` was absent -- it took the message, said "Zap recorded!" and
 * closed without writing anything.
 *
 * Tested through the page rather than by reading it, because what went wrong
 * was the wiring and not either component on its own.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
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

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('qrcode.react', () => ({ QRCodeSVG: () => <svg data-testid="qr" /> }));

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
    displayName: 'Rowan Blake',
    email: 'rowan@example.test',
    timezone: 'Europe/London',
    tags: [],
  },
  assignee: {
    id: 'u2',
    displayName: 'Alex Morgan',
    email: 'alex@example.test',
    uniqueName: 'alex@example.test',
  },
  tags: [],
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-02T00:00:00Z'),
  devOpsUrl: 'https://dev.azure.test/item/7',
  project: 'Internal',
  comments: [],
} as unknown as Ticket;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/api/lightning/user/')) {
        return { ok: true, json: async () => ({ lightningAddress: 'alex@example.test' }) };
      }
      // The invoice comes from our own API now (#627), not the LNURL provider.
      return { ok: true, status: 200, json: async () => ({ invoice: 'lnbc500n1testinvoice' }) };
    })
  );
});

afterEach(cleanup);

async function openZap(onAddComment?: (comment: string, isInternal?: boolean) => Promise<void>) {
  render(
    <TicketDetail
      ticket={ticket}
      comments={[]}
      history={[]}
      {...(onAddComment ? { onAddComment } : {})}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /^zap$/i }));
  // The dialog waits for the assignee's Lightning address before it shows
  // anything to act on.
  await screen.findByRole('button', { name: /know you/i });
}

describe('the zap dialog message field', () => {
  it('is offered when the page can post the comment', async () => {
    await openZap(async () => {});

    expect(screen.getByLabelText(/message on the ticket/i)).toBeDefined();
  });

  it('is not offered when the page has no way to post it', async () => {
    await openZap();

    expect(screen.queryByLabelText(/message on the ticket/i)).toBeNull();
  });
});
