import { describe, it, expect } from 'vitest';
import {
  TICKET_COLUMNS,
  TICKET_COLUMNS_WITH_SOURCE,
  itemNumber,
  itemSortNumber,
} from './WorkItemBoard';

describe('the Tickets list shows each ticket’s number', () => {
  it('has an ID column just before Type', () => {
    for (const columns of [TICKET_COLUMNS, TICKET_COLUMNS_WITH_SOURCE]) {
      const ids = columns.map((c) => c.id);
      expect(ids.indexOf('id')).toBe(ids.indexOf('type') - 1);
    }
  });

  it('shows the work item id, or a GitHub issue’s own number', () => {
    expect(itemNumber({ id: 8242 })).toBe('8242');
    expect(itemNumber({ id: -987654, source: 'github', sourceRef: 'contoso/app#42' })).toBe('#42');
    expect(itemNumber({ id: -987654, source: 'github' })).toBe('');
  });

  it('sorts GitHub rows by the issue number shown, not the internal id', () => {
    const rows = [
      { id: -2000, source: 'github', sourceRef: 'org/repo#42' },
      { id: -1000, source: 'github', sourceRef: 'org/repo#7' },
    ];
    const sorted = [...rows].sort((a, b) => itemSortNumber(a) - itemSortNumber(b));
    expect(sorted.map(itemNumber)).toEqual(['#7', '#42']);
    expect(itemSortNumber({ id: 8242 })).toBe(8242);
  });
});
