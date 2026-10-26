// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import SlaPausedNote from './SlaPausedNote';
import type { WorkItemUpdate } from '@/types';

/**
 * The note beside the SLA badge saying how much of the target was burnt while
 * nobody could act on the ticket (7386).
 */
afterEach(cleanup);

const CREATED = new Date('2026-10-01T00:00:00Z');
const HOUR = 60 * 60 * 1000;
const at = (h: number) => new Date(CREATED.getTime() + h * HOUR);

const change = (id: number, revisedAt: number, from: string, to: string) =>
  ({
    id,
    rev: id,
    revisedBy: { id: 'u', displayName: 'Someone', email: 'someone@example.test' },
    revisedDate: at(revisedAt),
    fields: { 'System.State': { oldValue: from, newValue: to } },
  }) as unknown as WorkItemUpdate;

const show = (updates: WorkItemUpdate[], now: Date) =>
  render(<SlaPausedNote updates={updates} createdAt={CREATED} now={now} />);

describe('SlaPausedNote', () => {
  it('says nothing for a ticket that was never blocked', () => {
    // Most tickets. An always-present note saying "0h" would be noise.
    const { container } = show([change(1, 2, 'New', 'Active')], at(10));
    expect(container.firstChild).toBeNull();
  });

  it('says nothing when there is no history at all', () => {
    const { container } = show([], at(10));
    expect(container.firstChild).toBeNull();
  });

  it('reports time already spent blocked, in the past tense', () => {
    show([change(1, 2, 'Active', 'Blocked'), change(2, 6, 'Blocked', 'Active')], at(10));

    expect(screen.getByRole('note').textContent).toContain('Spent 4h');
  });

  it('reports a ticket blocked right now in the present tense', () => {
    // "Blocked now" and "spent 8h blocked" say different things to someone
    // deciding whether to chase it.
    show([change(1, 2, 'Active', 'Blocked')], at(10));

    expect(screen.getByRole('note').textContent).toContain('Blocked now, 8h in total');
  });

  it('calls the figure a total when an earlier stretch is included', () => {
    // Blocked 1h-3h, picked up, blocked again at 9h. The note must not read as
    // "this ticket has been stuck for 3h" when the current stretch is only 1h.
    show(
      [
        change(1, 1, 'Active', 'Blocked'),
        change(2, 3, 'Blocked', 'Active'),
        change(3, 9, 'Active', 'Blocked'),
      ],
      at(10)
    );

    expect(screen.getByRole('note').textContent).toContain('Blocked now, 3h in total');
  });

  it('adds up separate blocked stretches rather than only the last', () => {
    show(
      [
        change(1, 1, 'Active', 'Blocked'),
        change(2, 3, 'Blocked', 'Active'),
        change(3, 5, 'Active', 'Blocked'),
        change(4, 8, 'Blocked', 'Active'),
      ],
      at(10)
    );

    // Two hours, then three.
    expect(screen.getByRole('note').textContent).toContain('5h');
  });

  it('says plainly that the badge beside it does not account for this', () => {
    // The whole point: the reader must not take the badge as corrected.
    show([change(1, 2, 'Active', 'Blocked')], at(10));

    expect(screen.getByRole('note').textContent).toMatch(/SLA badge above still counts/);
  });
});
