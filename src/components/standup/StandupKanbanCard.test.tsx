// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import StandupKanbanCard from './StandupKanbanCard';
import type { StandupWorkItem } from '@/types';

/**
 * How a card on the Kanban Board page opens (#566).
 *
 * A GitHub issue used to be the one thing on the board you had to leave
 * ZapDesk to read: its card was an anchor to github.com, and it returned
 * before the click handler every other card goes through.
 */
afterEach(cleanup);

const card = (overrides: Partial<StandupWorkItem> = {}): StandupWorkItem =>
  ({
    id: -9001,
    title: 'Export fails on large files',
    state: 'New',
    stateCategory: 'Proposed',
    workItemType: 'Issue',
    project: 'Widgets',
    updatedAt: '2026-10-02T10:30:00.000Z',
    createdAt: '2026-10-01T09:00:00.000Z',
    devOpsUrl: 'https://github.com/acme/portal/issues/12',
    tags: [],
    source: 'github',
    sourceUrl: 'https://github.com/acme/portal/issues/12',
    sourceRef: 'acme/portal#12',
    ...overrides,
  }) as unknown as StandupWorkItem;

describe('a GitHub card on the Kanban board', () => {
  it('opens the ZapDesk pop-up when the board has one', () => {
    const onClick = vi.fn();
    render(<StandupKanbanCard item={card()} onClick={onClick} />);

    // A button, not a link out: no anchor to github.com on the card.
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open acme/portal#12' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0].sourceRef).toBe('acme/portal#12');
  });

  it('still links to GitHub where no pop-up is offered', () => {
    // Better than a card that does nothing at all.
    render(<StandupKanbanCard item={card()} />);

    const link = screen.getByRole('link', { name: 'Open acme/portal#12 on GitHub' });
    expect(link.getAttribute('href')).toBe('https://github.com/acme/portal/issues/12');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('opens a DevOps card the same way', () => {
    const onClick = vi.fn();
    render(
      <StandupKanbanCard
        item={card({ id: 7777, source: undefined, sourceRef: undefined, workItemType: 'Task' })}
        onClick={onClick}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Task #7777' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
