import { describe, it, expect, vi, afterEach } from 'vitest';
import { recordedAuthorFor, recordedAuthors, type RawRevision } from './comment-revisions';
import { AzureDevOpsService } from './devops';

// What DevOps returns for a reply an import wrote as its original author: the
// Comments list names the importing account at the moment of the write, the
// revision names the original author at the original time.
const IMPORTER = {
  id: 'importer',
  displayName: 'Import Account',
  uniqueName: 'importer@example.test',
};
const AGENT = {
  id: 'agent-1',
  displayName: 'Sam Taylor',
  uniqueName: 'sam.taylor@example.com',
  imageUrl: 'https://example.test/sam.png',
};
const WRITTEN_AT = '2026-11-27T11:50:32.467Z';

const revision = (text: string, by: unknown, at: string, authorized = WRITTEN_AT): RawRevision =>
  ({
    fields: {
      'System.History': { newValue: text },
      'System.AuthorizedDate': { newValue: authorized },
      'System.ChangedBy': { newValue: by },
      'System.ChangedDate': { newValue: at },
    },
  }) as RawRevision;

const comment = (text: string, createdDate = WRITTEN_AT, createdBy = IMPORTER) => ({
  text,
  createdDate,
  createdBy,
});

describe('recordedAuthorFor', () => {
  it('finds the original author and time of an imported reply', () => {
    const recorded = recordedAuthors([
      revision('<p>Printer fixed </p>', AGENT, '2026-04-22T07:58:00Z'),
    ]);
    expect(recordedAuthorFor(comment('<p>Printer fixed </p>'), recorded)).toEqual({
      by: AGENT,
      at: '2026-04-22T07:58:00Z',
    });
  });

  it('reads an author stored as a plain name', () => {
    const recorded = recordedAuthors([
      revision('<p>Thanks</p>', 'Alex Morgan', '2026-04-27T15:59:16Z'),
    ]);
    expect(recordedAuthorFor(comment('<p>Thanks</p>'), recorded)?.by).toEqual({
      displayName: 'Alex Morgan',
    });
  });

  it('leaves an ordinary comment alone', () => {
    const recorded = recordedAuthors([revision('<p>Looking now</p>', IMPORTER, WRITTEN_AT)]);
    expect(recordedAuthorFor(comment('<p>Looking now</p>'), recorded)).toBeNull();
  });

  it('needs both the write time and the text to match', () => {
    const recorded = recordedAuthors([
      revision('<p>Printer fixed </p>', AGENT, '2026-04-22T07:58:00Z'),
    ]);
    expect(recordedAuthorFor(comment('<p>Something else</p>'), recorded)).toBeNull();
    expect(
      recordedAuthorFor(comment('<p>Printer fixed </p>', '2026-11-27T11:50:33.000Z'), recorded)
    ).toBeNull();
  });

  it('skips revisions that added no comment', () => {
    expect(recordedAuthors([{ fields: { 'System.ChangedBy': { newValue: AGENT } } }]).size).toBe(0);
    expect(recordedAuthors([{}]).size).toBe(0);
  });
});

describe('getWorkItemComments shows the recorded author', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stub = (updates: unknown, updatesOk = true) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/updates')
          ? updatesOk
            ? Response.json(updates)
            : new Response('nope', { status: 500 })
          : Response.json({
              comments: [
                {
                  id: 2,
                  text: '<p>Agent here.</p>',
                  createdDate: '2026-11-27T12:00:00Z',
                  createdBy: IMPORTER,
                },
                {
                  id: 1,
                  text: '<p>Printer fixed </p>',
                  createdDate: WRITTEN_AT,
                  createdBy: IMPORTER,
                },
              ],
            })
      )
    );

  it('uses the history for an imported reply and the Comments list for the rest', async () => {
    stub({ value: [revision('<p>Printer fixed </p>', AGENT, '2026-04-22T07:58:00Z')] });
    const [ordinary, imported] = await new AzureDevOpsService('token', 'acme').getWorkItemComments(
      'Contoso Ltd',
      8001
    );

    expect(imported.author).toEqual({
      id: 'agent-1',
      displayName: 'Sam Taylor',
      email: 'sam.taylor@example.com',
      avatarUrl: 'https://example.test/sam.png',
    });
    expect(imported.createdAt.toISOString()).toBe('2026-04-22T07:58:00.000Z');
    expect(ordinary.author.displayName).toBe('Import Account');
    expect(ordinary.createdAt.toISOString()).toBe('2026-11-27T12:00:00.000Z');
  });

  it('still loads the comments when the history cannot be read', async () => {
    stub(null, false);
    const comments = await new AzureDevOpsService('token', 'acme').getWorkItemComments(
      'Contoso Ltd',
      8001
    );
    expect(comments.map((c) => c.author.displayName)).toEqual(['Import Account', 'Import Account']);
  });
});
