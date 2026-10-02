import { describe, it, expect, vi, afterEach } from 'vitest';
import { AzureDevOpsService, isInternalNote, stripInternalNoteMarker } from './devops';

// DevOps has no private-comment concept, so the marker in the text is the only
// record that a note was meant to stay off the customer's email. Both halves
// have to agree: the comments endpoint filters reply history on this prefix.
describe('internal note marker', () => {
  it.each([
    ['plain', '[Internal Note] Checked the logs, looks like DNS.'],
    ['wrapped in markup', '<div>[Internal Note] Checked the logs.</div>'],
    ['leading whitespace', '   [Internal Note] Checked the logs.'],
    ['lowercase', '[internal note] Checked the logs.'],
  ])('detects a note %s', (_name, text) => {
    expect(isInternalNote(text)).toBe(true);
  });

  it.each([
    ['an ordinary comment', 'Thanks, that worked.'],
    ['the phrase mid-body', 'I left an [Internal Note] on the other ticket.'],
    ['empty', ''],
  ])('does not treat %s as a note', (_name, text) => {
    expect(isInternalNote(text)).toBe(false);
  });

  it('removes the marker for display but keeps the wrapper', () => {
    expect(stripInternalNoteMarker('<div>[Internal Note] Checked the logs.</div>')).toBe(
      '<div>Checked the logs.</div>'
    );
  });

  it('leaves an ordinary comment untouched', () => {
    expect(stripInternalNoteMarker('Thanks, that worked.')).toBe('Thanks, that worked.');
  });

  // The round trip the API and the timeline both depend on.
  it('survives write-then-read', () => {
    const stored = `[Internal Note] ${'Only for the team.'}`;
    expect(isInternalNote(stored)).toBe(true);
    expect(stripInternalNoteMarker(stored)).toBe('Only for the team.');
  });
});

// The helpers being right is not the same as the mapping using them. This is
// the seam where a regression would quietly mark every internal note public
// again, which is the failure that puts team discussion in a customer's inbox.
describe('getWorkItemComments maps the marker', () => {
  afterEach(() => vi.unstubAllGlobals());

  const withComments = (texts: string[]) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          comments: texts.map((text, i) => ({
            id: i + 1,
            text,
            createdDate: '2026-01-01T00:00:00Z',
            createdBy: { id: 'u1', displayName: 'Agent', uniqueName: 'a@x.test' },
          })),
        })
      )
    );

  it('flags a note and hides its marker, leaving public comments alone', async () => {
    withComments(['[Internal Note] Checked the logs.', 'Thanks, that worked.']);
    const comments = await new AzureDevOpsService('token').getWorkItemComments('Proj', 1);

    expect(comments[0].isInternal).toBe(true);
    expect(comments[0].content).toBe('Checked the logs.');
    expect(comments[1].isInternal).toBe(false);
    expect(comments[1].content).toBe('Thanks, that worked.');
  });
});

// The reply history the comments route emails to the customer is filtered here.
// It used to match on the marker text, which stopped excluding anything the
// moment the marker began being stripped on read -- so the two changes were
// individually correct and together a leak. This pins the composition.
describe('reply history excludes internal notes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('filters on isInternal, where a text match would no longer work', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          comments: [
            {
              id: 1,
              text: '[Internal Note] Firewall change, do not tell them yet.',
              createdDate: '2026-01-01T00:00:00Z',
              createdBy: { id: 'u1', displayName: 'Agent', uniqueName: 'a@x.test' },
            },
            {
              id: 2,
              text: 'We are looking into it.',
              createdDate: '2026-01-01T01:00:00Z',
              createdBy: { id: 'u1', displayName: 'Agent', uniqueName: 'a@x.test' },
            },
          ],
        })
      )
    );

    const comments = await new AzureDevOpsService('token').getWorkItemComments('Proj', 1);

    // What the route does now.
    const history = comments.filter((c) => !c.isInternal);
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe('We are looking into it.');

    // What it used to do — kept as the reason the fix exists.
    const byText = comments.filter((c) => !c.content.includes('[Internal Note]'));
    expect(byText).toHaveLength(2);
  });
});
