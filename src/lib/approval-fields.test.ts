import { describe, it, expect } from 'vitest';
import { readDateField, readIdentityField, ticketToWorkItem, workItemToTicket } from './devops';
import type { DevOpsWorkItem } from '@/types';
import { OPTIONAL_TICKET_FIELDS, ticketFieldsToRequest } from './work-item-fields';

/**
 * Approved By and Approved Date, read off the work item so the details panel
 * can show who approved it and when.
 */

const workItem = (extra: Record<string, unknown>): DevOpsWorkItem =>
  ({
    id: 7747,
    fields: {
      'System.Title': 'Printer offline',
      'System.State': 'Active',
      'System.WorkItemType': 'Bug',
      'System.TeamProject': 'Contoso Ltd',
      'System.CreatedDate': '2026-11-01T09:00:00Z',
      'System.ChangedDate': '2026-11-02T09:00:00Z',
      'System.CreatedBy': { displayName: 'Sam Taylor', uniqueName: 'sam@example.com', id: 's1' },
      ...extra,
    },
  }) as unknown as DevOpsWorkItem;

describe('readIdentityField', () => {
  it('reads the identity object DevOps returns', () => {
    expect(
      readIdentityField({
        displayName: 'Alex Morgan',
        uniqueName: 'alex@example.com',
        id: 'a1',
        imageUrl: 'https://example.com/a1.png',
      })
    ).toEqual({
      id: 'a1',
      displayName: 'Alex Morgan',
      email: 'alex@example.com',
      avatarUrl: 'https://example.com/a1.png',
    });
  });

  it('ignores an image URL that is not a string', () => {
    expect(
      readIdentityField({ displayName: 'Alex Morgan', id: 'a1', imageUrl: 42 })?.avatarUrl
    ).toBe('/api/devops/avatar/a1');
  });

  it('reads the "Name <email>" string form', () => {
    expect(readIdentityField('Sam Taylor <sam@example.com>')).toEqual({
      id: '',
      displayName: 'Sam Taylor',
      email: 'sam@example.com',
    });
  });

  it('is undefined when unset or not a person', () => {
    expect(readIdentityField(undefined)).toBeUndefined();
    expect(readIdentityField('')).toBeUndefined();
    expect(readIdentityField({ uniqueName: 'x@example.com' })).toBeUndefined();
    expect(readIdentityField(42)).toBeUndefined();
    expect(readIdentityField({ displayName: '   ', id: 'a1' })).toBeUndefined();
  });
});

describe('readDateField', () => {
  it('reads an ISO date', () => {
    expect(readDateField('2026-11-18T00:00:00Z')?.toISOString()).toBe('2026-11-18T00:00:00.000Z');
  });

  it('is undefined when unset or not a date', () => {
    expect(readDateField(undefined)).toBeUndefined();
    expect(readDateField('not a date')).toBeUndefined();
    expect(readDateField(12345)).toBeUndefined();
  });
});

describe('the approval on a ticket', () => {
  it('is carried from the work item to the ticket and on to the dialog', () => {
    const ticket = workItemToTicket(
      workItem({
        'Custom.ApprovedBy': {
          displayName: 'Alex Morgan',
          uniqueName: 'alex@example.com',
          id: 'a1',
        },
        'Custom.ApprovedDate': '2026-11-18T00:00:00Z',
      })
    );

    expect(ticket.approvedBy?.displayName).toBe('Alex Morgan');
    expect(ticket.approvedDate?.toISOString()).toBe('2026-11-18T00:00:00.000Z');

    const item = ticketToWorkItem(ticket);
    expect(item.approvedBy?.displayName).toBe('Alex Morgan');
    expect(item.approvedDate).toEqual(ticket.approvedDate);
  });

  it('is absent when the work item has no approval', () => {
    const ticket = workItemToTicket(workItem({}));

    expect(ticket.approvedBy).toBeUndefined();
    expect(ticket.approvedDate).toBeUndefined();
  });
});

// Naming a field an organisation lacks fails the whole batch read (TF51535),
// so the approval fields are only asked for where they exist.
describe('requesting the approval fields', () => {
  it('asks for them only from an organisation that defines them', () => {
    expect(OPTIONAL_TICKET_FIELDS).toContain('Custom.ApprovedBy');
    expect(ticketFieldsToRequest(new Set(['Custom.ApprovedBy', 'Custom.ApprovedDate']))).toEqual(
      expect.arrayContaining(['Custom.ApprovedBy', 'Custom.ApprovedDate'])
    );
    expect(ticketFieldsToRequest(new Set())).not.toContain('Custom.ApprovedBy');
  });
});
