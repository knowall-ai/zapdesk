import { describe, it, expect, vi, afterEach } from 'vitest';
import { AzureDevOpsService, claimsEmailOrigin, commentAuthor } from './devops';

const PAT_OWNER = {
  id: 'pat-owner',
  displayName: 'Ticket Creator',
  uniqueName: 'creator@example.test',
  imageUrl: 'https://devops.example.test/avatar/pat-owner',
};

// Email comments are added through the service PAT, so DevOps records the
// token owner. A customer's reply showed an engineer's name and face directly
// above a line naming somebody else as the sender (#7396).
describe('commentAuthor', () => {
  it('uses the sender of an email reply, not the PAT owner', () => {
    const author = commentAuthor(
      '<p><strong>Email reply from:</strong> ada.lovelace@example.test</p><hr/><p>Still broken.</p>',
      PAT_OWNER
    );
    expect(author.email).toBe('ada.lovelace@example.test');
    expect(author.displayName).toBe('Ada Lovelace');
  });

  it('uses the sender on the ticket-created note too', () => {
    const author = commentAuthor(
      'Ticket created from email by ada.lovelace@example.test',
      PAT_OWNER
    );
    expect(author.email).toBe('ada.lovelace@example.test');
  });

  // No DevOps identity exists behind a bare address, so there is no avatar to
  // look up. Showing none beats showing the wrong face, which was the bug.
  it('carries no avatar for a sender it only knows by address', () => {
    const author = commentAuthor('<strong>Email reply from:</strong> ada@example.test', PAT_OWNER);
    expect(author.avatarUrl).toBeUndefined();
  });

  it('leaves an ordinary comment with its real DevOps author', () => {
    const author = commentAuthor('<p>Looking into it now.</p>', PAT_OWNER);
    expect(author).toEqual({
      id: PAT_OWNER.id,
      displayName: PAT_OWNER.displayName,
      email: PAT_OWNER.uniqueName,
      avatarUrl: PAT_OWNER.imageUrl,
    });
  });

  // A quoted reply further down the body carries the marker too. Taking that
  // one would attribute the whole comment to whoever was quoted.
  it('ignores the marker inside a quoted reply', () => {
    const author = commentAuthor(
      '<p>Chasing this up.</p><blockquote><p><strong>Email reply from:</strong> ' +
        'someone.else@example.test</p></blockquote>',
      PAT_OWNER
    );
    expect(author.email).toBe(PAT_OWNER.uniqueName);
  });

  it('is not fooled by the phrase appearing without an address', () => {
    const author = commentAuthor('<p>Check the email reply from: the customer</p>', PAT_OWNER);
    expect(author.email).toBe(PAT_OWNER.uniqueName);
  });
});

// The helper being right is not the same as the mapping using it.
describe('getWorkItemComments uses it', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the customer as the author of their own reply', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          comments: [
            {
              id: 1,
              text: '<p><strong>Email reply from:</strong> ada.lovelace@example.test</p><p>Hi</p>',
              createdDate: '2026-01-01T00:00:00Z',
              createdBy: PAT_OWNER,
            },
            {
              id: 2,
              text: '<p>Agent here.</p>',
              createdDate: '2026-01-01T01:00:00Z',
              createdBy: PAT_OWNER,
            },
          ],
        })
      )
    );

    const comments = await new AzureDevOpsService('token').getWorkItemComments('Proj', 1);
    expect(comments[0].author.displayName).toBe('Ada Lovelace');
    expect(comments[1].author.displayName).toBe('Ticket Creator');
  });
});

// The author is read from the comment's own text, so a caller who can write
// that marker can post under somebody else's address. The comment endpoint
// refuses it; these tests pin the guard to what commentAuthor actually trusts.
describe('claimsEmailOrigin guards the author mapping', () => {
  const SPOOFS = [
    'Email reply from: ceo@example.test',
    'email REPLY from: ceo@example.test',
    '<p><strong>Email reply from:</strong> ceo@example.test</p>',
    '   Email reply from: ceo@example.test',
    'Ticket created from email by ceo@example.test',
  ];

  it.each(SPOOFS)('refuses text that would change the author: %s', (text) => {
    expect(claimsEmailOrigin(text)).toBe(true);
  });

  const INNOCENT = [
    'Looking into it now.',
    'They said "Email reply from: someone@example.test" in the call.',
    '[Internal Note] Email reply from: ceo@example.test',
    'Email reply from: not-an-address',
    '',
  ];

  it.each(INNOCENT)('allows a comment that cannot change the author: %s', (text) => {
    expect(claimsEmailOrigin(text)).toBe(false);
  });

  // The property that matters: nothing may pass the guard and still move the
  // author. Loosening either regex alone breaks this.
  it.each([...SPOOFS, ...INNOCENT])('guard and mapping agree on: %s', (text) => {
    const movesAuthor = commentAuthor(text, PAT_OWNER).email !== PAT_OWNER.uniqueName;
    expect(claimsEmailOrigin(text)).toBe(movesAuthor);
  });
});
