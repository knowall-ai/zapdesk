import { describe, it, expect } from 'vitest';
import { workItemToTicket } from './devops';

const CREATED_BY = {
  displayName: 'Ticket Creator',
  uniqueName: 'creator@example.test',
  id: 'pat-owner-id',
};

const workItem = (tags: string) => ({
  id: 7364,
  fields: {
    'System.Title': 'Test',
    'System.Description': 'From: ada.lovelace@example.test',
    'System.State': 'New',
    'System.WorkItemType': 'Task',
    'System.CreatedBy': CREATED_BY,
    'System.CreatedDate': '2026-09-29T17:48:00Z',
    'System.ChangedDate': '2026-09-29T17:48:00Z',
    'System.TeamProject': 'Internal',
    'System.Tags': tags,
  },
});

// Every email ticket is created through the PAT, so System.CreatedBy names the
// token owner rather than whoever wrote in. Left alone, the whole email channel
// looks like one person filed it.
describe('requester on an email ticket', () => {
  it('uses the sender from the email-from tag, not the PAT owner', () => {
    const t = workItemToTicket(
      workItem('ticket; email; email-from:ada.lovelace@example.test') as never
    );
    expect(t.requester.email).toBe('ada.lovelace@example.test');
    expect(t.requester.email).not.toBe(CREATED_BY.uniqueName);
  });

  it('builds a readable name from the address', () => {
    const t = workItemToTicket(
      workItem('ticket; email; email-from:ada.lovelace@example.test') as never
    );
    expect(t.requester.displayName).toBe('Ada Lovelace');
  });

  // A ticket raised in the UI has no tag, and there the creator really is the
  // requester — so the fallback has to stay.
  it('falls back to the creator when there is no email-from tag', () => {
    const t = workItemToTicket(workItem('ticket') as never);
    expect(t.requester.email).toBe(CREATED_BY.uniqueName);
    expect(t.requester.displayName).toBe('Ticket Creator');
  });

  it('copes with no tags at all', () => {
    const t = workItemToTicket(workItem('') as never);
    expect(t.requester.email).toBe(CREATED_BY.uniqueName);
  });
});

// Tags are editable by anyone with work item access, so the value after
// `email-from:` is arbitrary text. Shown unchecked it becomes the display name
// and the Customer id, so anything that is not an address falls back instead.
describe('a malformed email-from tag', () => {
  it.each([
    ['no at sign', 'not-an-address'],
    ['empty local part', '@example.test'],
    ['empty domain', 'someone@'],
    ['two at signs', 'a@b@example.test'],
    ['contains a space', 'someone@ example.test'],
  ])('falls back to the creator when the tag is %s', (_name, value) => {
    const t = workItemToTicket(workItem(`ticket; email; email-from:${value}`) as never);
    expect(t.requester.email).toBe(CREATED_BY.uniqueName);
  });
});
