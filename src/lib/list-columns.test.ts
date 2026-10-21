import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readHiddenColumns,
  resetColumnMemory,
  resetColumns,
  setColumnHidden,
  visibleColumns,
} from './list-columns';

const store = new Map<string, string>();
const win = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  dispatchEvent: vi.fn(),
};

const columns = ['checkbox', 'type', 'status', 'subject', 'project', 'assignee'].map((id) => ({
  id,
}));
const ids = (cols: { id: string }[]) => cols.map((c) => c.id);

describe('list columns (#7397)', () => {
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('window', win);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('hides and shows a column, per kind of list', () => {
    setColumnHidden('tickets', 'project', true);
    expect(ids(visibleColumns(columns, readHiddenColumns('tickets')))).not.toContain('project');
    expect(ids(visibleColumns(columns, readHiddenColumns('workitems')))).toContain('project');
    setColumnHidden('tickets', 'project', false);
    expect(ids(visibleColumns(columns, readHiddenColumns('tickets')))).toContain('project');
  });

  it('never hides the subject or the checkbox', () => {
    setColumnHidden('tickets', 'subject', true);
    expect(ids(visibleColumns(columns, new Set(['subject', 'checkbox', 'type'])))).toEqual([
      'checkbox',
      'status',
      'subject',
      'project',
      'assignee',
    ]);
    expect(readHiddenColumns('tickets').has('subject')).toBe(false);
  });

  it('shows everything again after a reset, or with a damaged saved value', () => {
    setColumnHidden('tickets', 'type', true);
    resetColumns('tickets');
    expect(readHiddenColumns('tickets').size).toBe(0);
    store.set('zapdesk:hidden-columns:tickets', '{not json');
    expect(readHiddenColumns('tickets').size).toBe(0);
  });
});

describe('with storage blocked', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetColumnMemory();
  });

  it('still hides a column for this page load', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('window', {
      localStorage: { getItem: blocked, setItem: blocked, removeItem: blocked },
      dispatchEvent: vi.fn(),
    });
    setColumnHidden('tickets', 'project', true);
    expect(readHiddenColumns('tickets').has('project')).toBe(true);
    resetColumns('tickets');
    expect(readHiddenColumns('tickets').size).toBe(0);
  });
});
