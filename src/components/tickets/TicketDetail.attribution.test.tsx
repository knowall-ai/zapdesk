// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import type { Ticket, WorkItemUpdate } from '@/types';

/**
 * Who the timeline says raised an emailed ticket (7770).
 *
 * Ingest writes to DevOps with the service PAT, so DevOps records the account
 * that owns it as the author of the creation. The customer is recovered from
 * the `email-from:` tag -- but that tag is editable, so the entry is read from
 * the tags the ticket was *created* with and not from the live ones.
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

import TicketDetail from './TicketDetail';

// The requester is resolved from the *live* `email-from:` tag, so a fixture
// has to keep the two consistent or it tests a state that cannot happen.
const ticket = (
  tags: string[],
  requester = { displayName: 'Rowan Blake', email: 'rowan@example.test' }
) =>
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
      displayName: requester.displayName,
      email: requester.email,
      timezone: 'Europe/London',
      tags: [],
    },
    tags,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-02T00:00:00Z'),
    devOpsUrl: 'https://dev.azure.test/item/7',
    project: 'Internal',
    comments: [],
  }) as unknown as Ticket;

const revision = (id: number, tags: string): WorkItemUpdate =>
  ({
    id,
    rev: id,
    revisedBy: { id: 'u1', displayName: 'Service Account' },
    revisedDate: new Date('2026-10-01T09:00:00Z'),
    fields: { 'System.Tags': { newValue: tags } },
  }) as unknown as WorkItemUpdate;

function showTimeline(props: {
  tags: string[];
  history: WorkItemUpdate[];
  requester?: { displayName: string; email: string };
}) {
  render(
    <TicketDetail
      ticket={ticket(props.tags, props.requester)}
      comments={[]}
      history={props.history}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
  return within(screen.getByTestId('history-entry-1'));
}

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

describe('timeline attribution of an emailed ticket', () => {
  it('credits the creation to the sender, not the token holder', () => {
    const creation = showTimeline({
      tags: ['ticket', 'email', 'email-from:rowan@example.test'],
      history: [revision(1, 'ticket; email; email-from:rowan@example.test')],
    });

    expect(creation.getByText('Rowan Blake')).toBeDefined();
    expect(creation.queryByText('Service Account')).toBeNull();
    expect(creation.getByText('by email')).toBeDefined();
  });

  it('still credits the sender after the email tags are removed', () => {
    // Removing the tags cannot unmake how the ticket arrived, and the entry
    // describes something that has already happened.
    const creation = showTimeline({
      tags: ['ticket'],
      history: [revision(1, 'ticket; email; email-from:rowan@example.test')],
    });

    expect(creation.getByText('by email')).toBeDefined();
  });

  it('shows the recorded address once it no longer matches the requester', () => {
    // The requester's name is resolved from the *current* tag, so it stops
    // belonging to this entry the moment the address is edited. The address
    // the ticket actually arrived from is then all there is to show.
    const creation = showTimeline({
      tags: ['ticket', 'email', 'email-from:dana@example.test'],
      requester: { displayName: 'Dana Shaw', email: 'dana@example.test' },
      history: [revision(1, 'ticket; email; email-from:rowan@example.test')],
    });

    expect(creation.getByText('rowan@example.test')).toBeDefined();
    expect(creation.queryByText('Dana Shaw')).toBeNull();
  });

  it('leaves a ticket raised in the app alone', () => {
    const creation = showTimeline({
      tags: ['ticket'],
      history: [revision(1, 'ticket')],
    });

    expect(creation.getByText('Service Account')).toBeDefined();
    expect(creation.queryByText('by email')).toBeNull();
  });

  it('does not credit a creation that had no tags to a later sender', () => {
    // The email tags were added after the fact. The creation revision is the
    // evidence, and it says the ticket did not arrive by email.
    const creation = showTimeline({
      tags: ['ticket', 'email', 'email-from:rowan@example.test'],
      history: [revision(1, '')],
    });

    expect(creation.getByText('Service Account')).toBeDefined();
    expect(creation.queryByText('by email')).toBeNull();
  });

  it('falls back to the live tags while the history has not arrived', () => {
    render(
      <TicketDetail
        ticket={ticket(['ticket', 'email', 'email-from:rowan@example.test'])}
        comments={[]}
        history={[]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));

    expect(screen.getByText('No history available')).toBeDefined();
  });
});
