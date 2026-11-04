import { describe, it, expect, vi, afterEach } from 'vitest';
import { AzureDevOpsService } from './devops';

/**
 * What counts as a ticket (#7774).
 *
 * The tag was the entire definition, and a tag is editable by anyone who can
 * open the work item. Remove it -- by accident, or by an automation that
 * rewrites tags -- and the ticket disappears from ZapDesk while sitting
 * untouched in DevOps. That is the risk raised on the board as AB#7774: not
 * that a ticket is lost, but that it becomes invisible -- which for a support
 * desk is the same thing.
 *
 * On the Support Ticket process (#569) the work item *type* carries the
 * meaning instead, and a type cannot be cleared the way a tag can. These
 * tests pin both halves: the type is enough on its own, and the tag still
 * works everywhere else, because every project on a development process
 * identifies its tickets that way and must keep working.
 */

/** The WIQL of the first query the service sends, with whitespace flattened. */
const capturedQuery = (fetchMock: ReturnType<typeof vi.fn>): string => {
  const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as { query: string };
  return body.query.replace(/\s+/g, ' ');
};

const stubEmptyResult = () => {
  const f = vi.fn().mockResolvedValue({
    ok: true,
    statusText: 'OK',
    json: async () => ({ workItems: [] }),
  });
  vi.stubGlobal('fetch', f);
  return f;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('which work items ZapDesk treats as tickets (#7774)', () => {
  it('accepts the ticket tag or the Ticket work item type', async () => {
    const f = stubEmptyResult();

    await new AzureDevOpsService('token', 'example-org').getTickets('Support');

    const query = capturedQuery(f);
    expect(query).toContain("[System.Tags] CONTAINS 'ticket'");
    expect(query).toContain("[System.WorkItemType] = 'Ticket'");
    // Either one, not both -- a Ticket without the tag must still be found,
    // which is the point. An AND here would leave the risk exactly as it was.
    expect(query).toMatch(
      /\(\s*\[System\.Tags\] CONTAINS 'ticket' OR \[System\.WorkItemType\] = 'Ticket'\s*\)/
    );
  });

  it('still filters by nothing when the caller asks for every work item', async () => {
    const f = stubEmptyResult();

    await new AzureDevOpsService('token', 'example-org').getTickets('Support', {
      ticketsOnly: false,
    });

    const query = capturedQuery(f);
    // `System.Tags` is still SELECTed -- the ticket carries its tags either
    // way. What must be gone is the filtering on them.
    expect(query).not.toContain("CONTAINS 'ticket'");
    expect(query).not.toContain("[System.WorkItemType] = 'Ticket'");
  });

  it('keeps the type restriction independent of the ticket test', async () => {
    const f = stubEmptyResult();

    // `allowedTypes` excludes Epics and Features from the board. It must not
    // be confused with the Ticket clause: a project can both restrict types
    // and identify tickets by tag.
    await new AzureDevOpsService('token', 'example-org').getTickets('Support', {
      allowedTypes: ['Bug', 'Task'],
    });

    const query = capturedQuery(f);
    expect(query).toContain("[System.WorkItemType] IN ('Bug', 'Task')");
    expect(query).toContain("[System.Tags] CONTAINS 'ticket'");
  });
});
