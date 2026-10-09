import { describe, it, expect } from 'vitest';
import { revisionTimestamp } from './devops';

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
