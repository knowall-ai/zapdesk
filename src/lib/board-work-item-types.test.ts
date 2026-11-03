import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOARD_WORK_ITEM_TYPES, isBoardWorkItemType } from './board-work-item-types';

describe('isBoardWorkItemType', () => {
  it('accepts every type the board shows', () => {
    for (const type of BOARD_WORK_ITEM_TYPES) {
      expect(isBoardWorkItemType(type)).toBe(true);
    }
  });

  // The planning levels are containers for the work beside them; showing both
  // on one board counts the same work twice.
  it.each(['Epic', 'Feature', 'User Story', 'Test Case', 'Shared Steps', 'Code Review Request'])(
    'leaves out %s',
    (type) => {
      expect(isBoardWorkItemType(type)).toBe(false);
    }
  );

  // DevOps type names are case-sensitive, and so is the WIQL that filters on
  // them. A tolerant check here would disagree with the query.
  it('is case-sensitive, as the query is', () => {
    expect(isBoardWorkItemType('task')).toBe(false);
    expect(isBoardWorkItemType('BUG')).toBe(false);
  });

  it('has no duplicates', () => {
    expect(new Set(BOARD_WORK_ITEM_TYPES).size).toBe(BOARD_WORK_ITEM_TYPES.length);
  });
});

/**
 * The drift guard.
 *
 * Two places use this list: the WIQL that decides which types reach the board,
 * and state discovery, which decides which types the board can describe. If
 * they disagree the failure is quiet and strange rather than loud -- a type the
 * query fetches but discovery never described has no per-type state data, so
 * every card of that type is kept by the Removed filter, kept by the closed
 * window, and refused by every drop target.
 *
 * So neither place may write the names out again. The source is checked,
 * because a literal list re-added there would leave every other test green.
 */
describe('the board type list is not written out twice', () => {
  const devops = readFileSync(join(__dirname, 'devops.ts'), 'utf8');
  const standupRoute = readFileSync(
    join(__dirname, '..', 'app', 'api', 'devops', 'standup', 'route.ts'),
    'utf8'
  );

  it('is what the board query filters on', () => {
    expect(devops).toContain('BOARD_WORK_ITEM_TYPES.map(');
  });

  it('is what state discovery filters on', () => {
    expect(standupRoute).toContain('isBoardWorkItemType(');
  });

  it('is not re-declared as a literal anywhere that uses it', () => {
    // The shape the old code had: the six names quoted in one array.
    const asALiteralList = /\['Task',\s*'Bug'/;
    expect(asALiteralList.test(devops)).toBe(false);
    expect(asALiteralList.test(standupRoute)).toBe(false);
  });

  // Discovery must narrow before it asks, not after it has the answers: the
  // cost this exists to remove is the round trips, not the parsing.
  it('narrows the types before requesting their states', () => {
    const filterAt = standupRoute.indexOf('isBoardWorkItemType(');
    const statesRequestAt = standupRoute.indexOf('/states?api-version');
    expect(filterAt).toBeGreaterThan(-1);
    expect(statesRequestAt).toBeGreaterThan(-1);
    expect(filterAt).toBeLessThan(statesRequestAt);
  });
});
