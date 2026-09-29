import { describe, it, expect } from 'vitest';
import { workItemToTicket } from './devops';

const CREATED_BY = {
  displayName: 'Akash Jadhav',
  uniqueName: 'akash.jadhav@knowall.ai',
  id: 'pat-owner-id',
};

const workItem = (tags: string) => ({
  id: 7364,
  fields: {
    'System.Title': 'Test',
    'System.Description': 'From: valeriia.khudiakova@knowall.ai',
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
      workItem('ticket; email; email-from:valeriia.khudiakova@knowall.ai') as never
    );
    expect(t.requester.email).toBe('valeriia.khudiakova@knowall.ai');
    expect(t.requester.email).not.toBe(CREATED_BY.uniqueName);
  });

  it('builds a readable name from the address', () => {
    const t = workItemToTicket(
      workItem('ticket; email; email-from:valeriia.khudiakova@knowall.ai') as never
    );
    expect(t.requester.displayName).toBe('Valeriia Khudiakova');
  });

  // A ticket raised in the UI has no tag, and there the creator really is the
  // requester — so the fallback has to stay.
  it('falls back to the creator when there is no email-from tag', () => {
    const t = workItemToTicket(workItem('ticket') as never);
    expect(t.requester.email).toBe(CREATED_BY.uniqueName);
    expect(t.requester.displayName).toBe('Akash Jadhav');
  });

  it('copes with no tags at all', () => {
    const t = workItemToTicket(workItem('') as never);
    expect(t.requester.email).toBe(CREATED_BY.uniqueName);
  });
});
