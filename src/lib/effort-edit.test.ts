import { describe, it, expect } from 'vitest';
import { effortChanges, parseHours } from './effort-edit';

describe('parseHours', () => {
  it.each([
    ['', 0],
    ['  ', 0],
    ['3', 3],
    ['1.25', 1.25],
    ['1,5', 1.5],
    ['0', 0],
  ])('reads %j as %d', (raw, hours) => {
    expect(parseHours(raw)).toBe(hours);
  });

  it.each(['-1', 'abc', 'Infinity', '1e999'])('refuses %j', (raw) => {
    expect(parseHours(raw)).toBeNull();
  });
});

describe('effortChanges (#7728)', () => {
  it('sends only the field that changed', () => {
    expect(
      effortChanges({ completedWork: 2, remainingWork: 4 }, { completedWork: 2, remainingWork: 6 })
    ).toEqual({ remainingWork: 4 });
  });

  it('keeps an exact value it was not asked to change', () => {
    // 1.25 must not be rewritten as anything when only remaining work moves.
    expect(
      effortChanges(
        { completedWork: 1.25, remainingWork: 3 },
        { completedWork: 1.25, remainingWork: 5 }
      )
    ).toEqual({ remainingWork: 3 });
  });

  it('does not send a field the item lacks unless it was set', () => {
    // A Scrum Task: Remaining Work only. Completed stays at the implied 0.
    expect(effortChanges({ completedWork: 0, remainingWork: 2 }, { remainingWork: 8 })).toEqual({
      remainingWork: 2,
    });
  });

  it('sends nothing when nothing changed', () => {
    expect(
      effortChanges({ completedWork: 1, remainingWork: 2 }, { completedWork: 1, remainingWork: 2 })
    ).toEqual({});
  });

  it('sends both when both changed', () => {
    expect(
      effortChanges({ completedWork: 3, remainingWork: 1 }, { completedWork: 2, remainingWork: 2 })
    ).toEqual({ completedWork: 3, remainingWork: 1 });
  });
});
