import { describe, it, expect } from 'vitest';
import { isInHandColumn } from './in-hand-columns';

describe('isInHandColumn (#619)', () => {
  it('names the columns a stand-up is about', () => {
    expect(isInHandColumn('To Do')).toBe(true);
    expect(isInHandColumn('Active')).toBe(true);
  });

  it('ignores the spacing and casing the column is labelled with', () => {
    // "To Do" is the label; the state behind it is "Todo" in the KnowAll
    // process, and the board passes whichever it has.
    for (const name of ['to do', 'ToDo', 'TODO', 'todo', 'active', 'ACTIVE']) {
      expect(isInHandColumn(name)).toBe(true);
    }
  });

  it('leaves every other column highlighting as it was', () => {
    // These are the columns where "did anything happen here" is the question,
    // so the ring and the fade are doing real work.
    for (const name of ['New', 'Blocked', 'Resolved', 'Closed', 'Removed']) {
      expect(isInHandColumn(name)).toBe(false);
    }
  });

  it('does not silently claim another process’s columns', () => {
    // Deliberate: Scrum's Committed, the Support Ticket process's Open and In
    // Progress mean much the same thing, but widening this without being asked
    // would change what Highlight mode does on every one of those boards.
    for (const name of ['Open', 'In Progress', 'Doing', 'Committed']) {
      expect(isInHandColumn(name)).toBe(false);
    }
  });
});
