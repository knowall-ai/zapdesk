import { describe, it, expect, vi, afterEach } from 'vitest';
import { AzureDevOpsService, revisionTimestamp } from './devops';

// In the work item updates API, `revisedDate` is when a revision was
// superseded, so it is one change late, and 9999-01-01 on the latest revision.
// History must show when each change was made (#233).
describe('revisionTimestamp', () => {
  it("uses the revision's own System.ChangedDate, not revisedDate", () => {
    expect(
      revisionTimestamp({
        revisedDate: '2026-02-20T11:39:00Z',
        fields: { 'System.ChangedDate': { newValue: '2026-02-20T08:41:00Z' } },
      })
    ).toBe('2026-02-20T08:41:00Z');
  });

  it('never returns the 9999 sentinel of the latest revision', () => {
    expect(
      revisionTimestamp({
        revisedDate: '9999-01-01T00:00:00Z',
        fields: { 'System.ChangedDate': { newValue: '2026-02-20T12:02:00Z' } },
      })
    ).toBe('2026-02-20T12:02:00Z');
    expect(revisionTimestamp({ revisedDate: '9999-01-01T00:00:00Z' })).toBe('');
  });

  it('falls back to revisedDate when the revision has no ChangedDate', () => {
    expect(revisionTimestamp({ revisedDate: '2026-02-20T11:45:00Z', fields: {} })).toBe(
      '2026-02-20T11:45:00Z'
    );
  });

  it('returns an empty string when nothing usable is present', () => {
    expect(revisionTimestamp({})).toBe('');
    expect(revisionTimestamp({ fields: { 'System.ChangedDate': { newValue: 42 } } })).toBe('');
  });
});

// The helper only fixes history if the service maps revisions through it.
describe('getWorkItemUpdates', () => {
  afterEach(() => vi.unstubAllGlobals());

  const revisedBy = { id: 'u1', displayName: 'Dana Smith', uniqueName: 'dana' };

  it('dates each revision by when it was made, through to the latest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          value: [
            {
              id: 1,
              rev: 1,
              revisedBy,
              revisedDate: '2026-02-20T11:39:00Z',
              fields: {
                'System.ChangedDate': { newValue: '2026-02-20T08:41:00Z' },
                'System.State': { newValue: 'New' },
              },
            },
            {
              id: 2,
              rev: 2,
              revisedBy,
              revisedDate: '9999-01-01T00:00:00Z',
              fields: {
                'System.ChangedDate': {
                  oldValue: '2026-02-20T08:41:00Z',
                  newValue: '2026-02-20T11:39:00Z',
                },
                'System.State': { oldValue: 'New', newValue: 'Active' },
              },
            },
          ],
        })
      )
    );

    const updates = await new AzureDevOpsService('token').getWorkItemUpdates('Proj', 1);

    expect(updates.map((u) => u.revisedDate)).toEqual([
      '2026-02-20T08:41:00Z',
      '2026-02-20T11:39:00Z',
    ]);
  });
});
