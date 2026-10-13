import { describe, it, expect } from 'vitest';
import {
  readExpandedGroups,
  writeGroupExpanded,
  readScrollTop,
  writeScrollTop,
  type PositionStorage,
} from './kanban-position';

// The Kanban board remembers which groups were open and how far down the user
// had scrolled, so coming back from a work item lands where they were (#318).

function memoryStorage(initial: Record<string, string> = {}): PositionStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const throwingStorage: PositionStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
};

describe('expanded groups', () => {
  it('remembers a group that was opened and forgets one that was closed', () => {
    const storage = memoryStorage();
    writeGroupExpanded(storage, 'org:project', 'Internal', true);
    writeGroupExpanded(storage, 'org:project', 'Glanau', true);
    expect(readExpandedGroups(storage, 'org:project')).toEqual(['Internal', 'Glanau']);

    writeGroupExpanded(storage, 'org:project', 'Internal', false);
    expect(readExpandedGroups(storage, 'org:project')).toEqual(['Glanau']);
  });

  it('does not list a group twice when it is opened twice', () => {
    const storage = memoryStorage();
    writeGroupExpanded(storage, 'org:project', 'Internal', true);
    writeGroupExpanded(storage, 'org:project', 'Internal', true);
    expect(readExpandedGroups(storage, 'org:project')).toEqual(['Internal']);
  });

  it('keeps scopes apart, so a person does not open a project of the same name', () => {
    const storage = memoryStorage();
    writeGroupExpanded(storage, 'org:project', 'Sam', true);
    expect(readExpandedGroups(storage, 'org:person')).toEqual([]);

    writeGroupExpanded(storage, 'org:person', 'Dana', true);
    expect(readExpandedGroups(storage, 'org:project')).toEqual(['Sam']);
    expect(readExpandedGroups(storage, 'org:person')).toEqual(['Dana']);
  });

  it('keeps only the most recently opened groups past the ceiling', () => {
    const storage = memoryStorage();
    for (let i = 0; i < 205; i++) writeGroupExpanded(storage, 's', `g${i}`, true);
    const groups = readExpandedGroups(storage, 's');
    expect(groups).toHaveLength(200);
    expect(groups[0]).toBe('g5');
    expect(groups.at(-1)).toBe('g204');
  });

  it('reads nothing from a stored value it does not understand', () => {
    for (const raw of ['not json', '[]', '"text"', '{"s":"Internal"}', 'null']) {
      const storage = memoryStorage({ 'zapdesk:kanban:expanded': raw });
      expect(readExpandedGroups(storage, 's')).toEqual([]);
    }
    const mixed = memoryStorage({ 'zapdesk:kanban:expanded': '{"s":["Internal",7,null]}' });
    expect(readExpandedGroups(mixed, 's')).toEqual(['Internal']);
  });

  it('replaces a stored value it does not understand on the next write', () => {
    const storage = memoryStorage({ 'zapdesk:kanban:expanded': 'not json' });
    writeGroupExpanded(storage, 's', 'Internal', true);
    expect(readExpandedGroups(storage, 's')).toEqual(['Internal']);
  });

  it('does nothing, without throwing, when storage is missing or refuses', () => {
    expect(readExpandedGroups(null, 's')).toEqual([]);
    expect(() => writeGroupExpanded(null, 's', 'Internal', true)).not.toThrow();
    expect(readExpandedGroups(throwingStorage, 's')).toEqual([]);
    expect(() => writeGroupExpanded(throwingStorage, 's', 'Internal', true)).not.toThrow();
  });
});

describe('scroll position', () => {
  it('returns the saved position for the same scope only', () => {
    const storage = memoryStorage();
    writeScrollTop(storage, 'org:project:all', 812.4);
    expect(readScrollTop(storage, 'org:project:all')).toBe(812);
    expect(readScrollTop(storage, 'org:person:all')).toBe(0);
  });

  it('keeps a position for each scope, so visiting another view does not lose the first', () => {
    const storage = memoryStorage();
    writeScrollTop(storage, 'org:project:all', 800);
    writeScrollTop(storage, 'org:person:all', 120);
    writeScrollTop(storage, 'org:project:sprint', 40);

    expect(readScrollTop(storage, 'org:project:all')).toBe(800);
    expect(readScrollTop(storage, 'org:person:all')).toBe(120);
    expect(readScrollTop(storage, 'org:project:sprint')).toBe(40);

    writeScrollTop(storage, 'org:project:all', 0);
    expect(readScrollTop(storage, 'org:project:all')).toBe(0);
    expect(readScrollTop(storage, 'org:person:all')).toBe(120);
  });

  it('drops the views scrolled longest ago past the ceiling', () => {
    const storage = memoryStorage();
    for (let i = 0; i < 52; i++) writeScrollTop(storage, `s${i}`, i + 1);
    // Scrolling an old view again makes it the newest.
    writeScrollTop(storage, 's2', 999);

    expect(readScrollTop(storage, 's0')).toBe(0);
    expect(readScrollTop(storage, 's1')).toBe(0);
    expect(readScrollTop(storage, 's2')).toBe(999);
    expect(readScrollTop(storage, 's51')).toBe(52);
    expect(Object.keys(JSON.parse(storage.data['zapdesk:kanban:scroll']))).toHaveLength(50);
  });

  it('never saves or returns a negative or meaningless position', () => {
    const storage = memoryStorage();
    writeScrollTop(storage, 's', -40);
    expect(readScrollTop(storage, 's')).toBe(0);

    for (const raw of ['not json', '{"s":"12"}', '{"s":-5}', '{"s":null}', '[]']) {
      expect(readScrollTop(memoryStorage({ 'zapdesk:kanban:scroll': raw }), 's')).toBe(0);
    }
  });

  it('does nothing, without throwing, when storage is missing or refuses', () => {
    expect(readScrollTop(null, 's')).toBe(0);
    expect(() => writeScrollTop(null, 's', 10)).not.toThrow();
    expect(readScrollTop(throwingStorage, 's')).toBe(0);
    expect(() => writeScrollTop(throwingStorage, 's', 10)).not.toThrow();
  });
});
