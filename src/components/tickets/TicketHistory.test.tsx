// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import TicketHistory from './TicketHistory';
import type { WorkItemUpdate } from '@/types';

/**
 * Who the timeline says did what (7770).
 *
 * Ingest writes with the service PAT, so DevOps records the account that owns
 * it as the author of every emailed ticket's creation.
 */
afterEach(cleanup);

const update = (id: number, name: string): WorkItemUpdate =>
  ({
    id,
    rev: id,
    revisedBy: { id: 'u1', displayName: name, uniqueName: 'pat.owner@example.test' },
    revisedDate: new Date('2026-10-24T09:00:00Z'),
    fields: {},
  }) as unknown as WorkItemUpdate;

describe('TicketHistory', () => {
  it('credits an emailed ticket to the customer, not the token holder', () => {
    render(
      <TicketHistory
        updates={[update(1, 'Service Account')]}
        loading={false}
        emailRequester={{ displayName: 'Rowan Blake' }}
      />
    );

    expect(screen.getByText('Rowan Blake')).toBeDefined();
    expect(screen.queryByText('Service Account')).toBeNull();
    expect(screen.getByText('by email')).toBeDefined();
  });

  it('leaves a ticket raised in the app alone', () => {
    render(<TicketHistory updates={[update(1, 'Dana Shaw')]} loading={false} />);

    expect(screen.getByText('Dana Shaw')).toBeDefined();
    expect(screen.queryByText('by email')).toBeNull();
  });

  it('does not reattribute later revisions, which may be that person working', () => {
    // The token holder is a real engineer too. Relabelling their own edits as
    // the customer would be a worse lie than the one being fixed.
    render(
      <TicketHistory
        updates={[update(1, 'Service Account'), update(2, 'Service Account')]}
        loading={false}
        emailRequester={{ displayName: 'Rowan Blake' }}
      />
    );

    expect(screen.getByText('Rowan Blake')).toBeDefined();
    expect(screen.getByText('Service Account')).toBeDefined();
  });
});
