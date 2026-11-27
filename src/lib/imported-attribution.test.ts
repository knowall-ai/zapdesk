import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  claimsZendeskImport,
  isZendeskImport,
  parseImportedComment,
  parseImportedRequester,
} from './imported-attribution';
import { AzureDevOpsService, workItemToTicket } from './devops';
import type { DevOpsWorkItem } from '@/types';

// What the import writes, and what DevOps stores it as: `&middot;` comes back
// as a literal `·`, so both must be read (#712).
const COMMENT_AS_WRITTEN =
  '<p><em>From Zendesk &middot; Alex Morgan &middot; 2026-04-22 07:58 UTC &middot; public reply</em></p><p>Printer is offline again.</p>';
const COMMENT_AS_STORED =
  '<p><em>From Zendesk · Sam Taylor · 2026-04-23 05:46 UTC · internal note</em> </p><p>Checked the spooler.</p>';
const DESCRIPTION =
  '<p><em>Imported from Zendesk #46 · requester Alex Morgan (alex.morgan@example.com) · created 2026-04-21 10:46 UTC · via email</em> </p><p>Printer offline</p>';

const PAT_OWNER = {
  id: 'pat-owner',
  displayName: 'Import Account',
  uniqueName: 'importer@example.test',
};

describe('parseImportedComment', () => {
  it('reads the author, time and kind the import wrote', () => {
    const comment = parseImportedComment(COMMENT_AS_WRITTEN);
    expect(comment).toMatchObject({
      authorName: 'Alex Morgan',
      isInternal: false,
      content: '<p>Printer is offline again.</p>',
    });
    expect(comment?.createdAt.toISOString()).toBe('2026-04-22T07:58:00.000Z');
  });

  it('reads the form DevOps stores, and an internal note', () => {
    const comment = parseImportedComment(COMMENT_AS_STORED);
    expect(comment?.authorName).toBe('Sam Taylor');
    expect(comment?.isInternal).toBe(true);
    expect(comment?.content).toBe('<p>Checked the spooler.</p>');
  });

  it('undoes the escaping of a name', () => {
    const text = COMMENT_AS_WRITTEN.replace('Alex Morgan', 'Contoso &amp; Partners');
    expect(parseImportedComment(text)?.authorName).toBe('Contoso & Partners');
  });

  // Quoted further down a reply, the header must not reattribute the comment.
  it('ignores a header that is not at the start', () => {
    expect(parseImportedComment(`<p>As before:</p>${COMMENT_AS_WRITTEN}`)).toBeNull();
    expect(parseImportedComment('<p>Ordinary comment</p>')).toBeNull();
  });

  it('is what the comment endpoint refuses', () => {
    expect(claimsZendeskImport(COMMENT_AS_WRITTEN)).toBe(true);
    expect(claimsZendeskImport('<p>From Zendesk, as discussed</p>')).toBe(false);
  });
});

describe('parseImportedRequester', () => {
  it('reads the requester name and address', () => {
    expect(parseImportedRequester(DESCRIPTION)).toEqual({
      name: 'Alex Morgan',
      email: 'alex.morgan@example.com',
    });
  });

  it('gives nothing when the import knew no address', () => {
    expect(
      parseImportedRequester(DESCRIPTION.replace(/requester .*? ·/, 'requester unknown ·'))
    ).toBeNull();
    expect(parseImportedRequester('<p>Printer offline</p>')).toBeNull();
  });
});

describe('isZendeskImport', () => {
  it('reads the tag from a DevOps tag string or a list', () => {
    expect(isZendeskImport('zendesk:46; Zendesk-Import; ticket')).toBe(true);
    expect(isZendeskImport(['ticket'])).toBe(false);
    expect(isZendeskImport(undefined)).toBe(false);
  });
});

const workItem = (tags: string, description = DESCRIPTION): DevOpsWorkItem =>
  ({
    id: 8001,
    fields: {
      'System.Title': 'Printer offline',
      'System.State': 'Closed',
      'System.WorkItemType': 'Task',
      'System.TeamProject': 'Contoso Ltd',
      'System.CreatedDate': '2026-04-21T10:46:00Z',
      'System.ChangedDate': '2026-11-27T09:00:00Z',
      'System.CreatedBy': PAT_OWNER,
      'System.Description': description,
      'System.Tags': tags,
    },
  }) as unknown as DevOpsWorkItem;

describe('an imported ticket shows its Zendesk requester', () => {
  it('names the requester from the description, not the import account', () => {
    const ticket = workItemToTicket(workItem('ticket; zendesk-import; zendesk:46'));
    expect(ticket.requester.displayName).toBe('Alex Morgan');
    expect(ticket.requester.email).toBe('alex.morgan@example.com');
  });

  // Tags are what mark an import; a description alone that looks like one
  // does not change who raised a ticket.
  it('keeps the creator for a ticket that is not an import', () => {
    expect(workItemToTicket(workItem('ticket')).requester.displayName).toBe('Import Account');
  });

  it('keeps the creator when the header names no address', () => {
    const ticket = workItemToTicket(workItem('ticket; zendesk-import', '<p>Printer offline</p>'));
    expect(ticket.requester.displayName).toBe('Import Account');
  });
});

describe('getWorkItemComments shows Zendesk authors and times', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the header for imported comments and DevOps for the rest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          comments: [
            {
              id: 1,
              text: COMMENT_AS_STORED,
              createdDate: '2026-11-26T13:01:18Z',
              createdBy: PAT_OWNER,
            },
            {
              id: 2,
              text: '<p>Agent here.</p>',
              createdDate: '2026-11-27T09:00:00Z',
              createdBy: PAT_OWNER,
            },
          ],
        })
      )
    );

    const [imported, ordinary] = await new AzureDevOpsService('token', 'acme').getWorkItemComments(
      'Contoso Ltd',
      8001
    );
    expect(imported.author.displayName).toBe('Sam Taylor');
    expect(imported.createdAt.toISOString()).toBe('2026-04-23T05:46:00.000Z');
    expect(imported.isInternal).toBe(true);
    expect(imported.content).toBe('<p>Checked the spooler.</p>');
    expect(ordinary.author.displayName).toBe('Import Account');
    expect(ordinary.createdAt.toISOString()).toBe('2026-11-27T09:00:00.000Z');
  });
});
