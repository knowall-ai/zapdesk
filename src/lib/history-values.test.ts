import { describe, it, expect, vi, afterEach } from 'vitest';
import { historyFieldValue } from './history-values';
import { AzureDevOpsService } from './devops';

// The history view showed "Assignee: [object Object]" (#232).

describe('historyFieldValue', () => {
  it('shows the display name of an identity object', () => {
    expect(
      historyFieldValue('System.AssignedTo', {
        displayName: 'Dana Example',
        uniqueName: 'dana@example.test',
        id: 'abc',
      })
    ).toBe('Dana Example');
  });

  it('never shows "[object Object]" for an identity with no display name', () => {
    expect(historyFieldValue('System.AssignedTo', { id: 'abc' })).toBe('Unknown user');
    expect(historyFieldValue('System.AssignedTo', { displayName: '  ' })).toBe('Unknown user');
  });

  it('shows the name alone for the combined "Name <address>" form', () => {
    expect(historyFieldValue('System.AssignedTo', 'Dana Example <dana@example.test>')).toBe(
      'Dana Example'
    );
    expect(
      historyFieldValue('System.AssignedTo', { displayName: 'Dana Example <dana@example.test>' })
    ).toBe('Dana Example');
    expect(historyFieldValue('System.AssignedTo', '<dana@example.test>')).toBe('Unknown user');
  });

  it('keeps a plain name as it is', () => {
    expect(historyFieldValue('System.AssignedTo', 'Dana Example')).toBe('Dana Example');
  });

  it('leaves angle brackets alone in fields that are not identities', () => {
    expect(historyFieldValue('System.Title', 'Compare a <b>')).toBe('Compare a <b>');
  });

  it('turns numbers into text and treats a missing value as none', () => {
    expect(historyFieldValue('Microsoft.VSTS.Common.Priority', 2)).toBe('2');
    expect(historyFieldValue('System.State', null)).toBeUndefined();
    expect(historyFieldValue('System.State', undefined)).toBeUndefined();
  });

  it('treats an object in a non-identity field as no value', () => {
    expect(historyFieldValue('System.Tags', { unexpected: true })).toBeUndefined();
  });
});

describe('getWorkItemUpdates assignee changes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns names for every shape DevOps sends the assignee in', async () => {
    const revisedBy = { id: 'u1', displayName: 'Sam Example', uniqueName: 'sam@example.test' };
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
                'System.AssignedTo': { newValue: { displayName: 'Dana Example', id: 'u2' } },
              },
            },
            {
              id: 2,
              rev: 2,
              revisedBy,
              revisedDate: '2026-02-21T09:00:00Z',
              fields: {
                'System.AssignedTo': {
                  oldValue: 'Dana Example <dana@example.test>',
                  newValue: { id: 'u3' },
                },
              },
            },
          ],
        })
      )
    );

    const updates = await new AzureDevOpsService('token', 'org').getWorkItemUpdates('Project', 7);

    expect(updates[0].fields['System.AssignedTo']).toEqual({
      oldValue: undefined,
      newValue: 'Dana Example',
    });
    expect(updates[1].fields['System.AssignedTo']).toEqual({
      oldValue: 'Dana Example',
      newValue: 'Unknown user',
    });
  });
});
