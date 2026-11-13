import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Both boards roll a cancelled drag back without an error toast (#662).
 *
 * `useBoardStateChange.test.tsx` covers the hook: a cancel rejects with
 * `StateChangeCancelled`, so the board rolls the card back. What it cannot
 * cover is the other half -- that the board then stays quiet. Each board's
 * rollback lives inside a dnd-kit `onDragEnd`, and driving a real drag in jsdom
 * means faking pointer events against a collision detector; the test would be
 * mostly scaffolding and would break on a dnd-kit upgrade for no good reason.
 *
 * So the source is checked directly, the way `devops-api-stability.test.ts`
 * guards its fix. What this catches is somebody adding a `catch` path, or
 * reordering this one, so that a cancel reaches `toast.error` -- which the app
 * would survive, while telling every user who closes a dialog that something
 * went wrong.
 */

const boards = [
  {
    file: join(__dirname, '..', 'components', 'standup', 'KanbanGroupSection.tsx'),
    name: 'the stand-up board',
    rollback: 'syncFromProps();',
  },
  {
    file: join(__dirname, '..', 'components', 'tickets', 'KanbanBoard.tsx'),
    name: 'the tickets board',
    rollback: 'setLocalItems(sourceItems);',
  },
];

describe.each(boards)('$name', ({ file, rollback }) => {
  const source = readFileSync(file, 'utf8');

  it('checks for a cancel in its drag-end catch', () => {
    expect(source).toContain('isStateChangeCancelled(error)');
  });

  it('rolls the card back on a cancel', () => {
    const guard = source.indexOf('isStateChangeCancelled(error)');
    expect(guard).toBeGreaterThan(-1);
    // Within the guarded block, not merely somewhere later in the file.
    const block = source.slice(guard, guard + 400);
    expect(block).toContain(rollback);
  });

  it('does not reach a toast on a cancel', () => {
    const guard = source.indexOf('isStateChangeCancelled(error)');
    const toast = source.indexOf('toast.error', guard);
    expect(toast, 'the catch should still show a toast for real failures').toBeGreaterThan(-1);
    // The guard returns before it. Without this the block falls through and
    // every cancel reads as a failure.
    const between = source.slice(guard, toast);
    expect(between).toContain('return;');
  });
});
