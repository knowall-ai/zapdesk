import { describe, it, expect } from 'vitest';
import { emailFromTag, hasEmailTag, hasTicketTag, tagsAtCreation } from './tags';
import type { WorkItemUpdate } from '@/types';

const revision = (id: number, tags?: string): WorkItemUpdate =>
  ({
    id,
    rev: id,
    revisedBy: { id: 'u1', displayName: 'Service Account' },
    revisedDate: new Date('2026-10-24T09:00:00Z'),
    fields: tags === undefined ? {} : { 'System.Tags': { newValue: tags } },
  }) as unknown as WorkItemUpdate;

describe('hasTicketTag / hasEmailTag', () => {
  it('ignores the casing DevOps users type', () => {
    expect(hasTicketTag(['Ticket'])).toBe(true);
    expect(hasEmailTag(['EMAIL'])).toBe(true);
  });

  it('does not match a tag that merely contains the word', () => {
    expect(hasTicketTag(['ticketing'])).toBe(false);
    expect(hasEmailTag(['email-from:rowan@example.test'])).toBe(false);
  });

  it('treats missing tags as no tags', () => {
    expect(hasTicketTag(null)).toBe(false);
    expect(hasEmailTag(undefined)).toBe(false);
  });
});

describe('emailFromTag', () => {
  it('reads the sender ingest recorded', () => {
    expect(emailFromTag(['ticket', 'email', 'email-from:rowan@example.test'])).toBe(
      'rowan@example.test'
    );
  });

  it('ignores the casing of the prefix and the padding around it', () => {
    expect(emailFromTag(['  Email-From: rowan@example.test  '])).toBe('rowan@example.test');
  });

  it('ignores a value that is not an address', () => {
    // The tag is editable like any other, so its contents are not trusted.
    expect(emailFromTag(['email-from:not an address'])).toBeUndefined();
  });

  it('is undefined when there is no such tag', () => {
    expect(emailFromTag(['ticket', 'email'])).toBeUndefined();
    expect(emailFromTag(null)).toBeUndefined();
  });
});

describe('tagsAtCreation', () => {
  it('reads the tags from the first revision, not the last', () => {
    // The point of the helper: `email-from:` can be edited afterwards, and
    // the creation entry describes something that has already happened.
    const updates = [
      revision(1, 'ticket; email; email-from:rowan@example.test'),
      revision(2, 'ticket'),
    ];

    expect(tagsAtCreation(updates)).toEqual(['ticket', 'email', 'email-from:rowan@example.test']);
    expect(emailFromTag(tagsAtCreation(updates))).toBe('rowan@example.test');
  });

  it('finds the creation revision wherever it sits in the list', () => {
    expect(tagsAtCreation([revision(2, 'ticket'), revision(1, 'ticket; email')])).toEqual([
      'ticket',
      'email',
    ]);
  });

  it('is undefined when the history is not loaded', () => {
    expect(tagsAtCreation([])).toBeUndefined();
    expect(tagsAtCreation(undefined)).toBeUndefined();
  });

  it('is undefined when the work item was created with no tags', () => {
    expect(tagsAtCreation([revision(1)])).toBeUndefined();
    expect(tagsAtCreation([revision(1, '  ;  ')])).toBeUndefined();
  });
});
