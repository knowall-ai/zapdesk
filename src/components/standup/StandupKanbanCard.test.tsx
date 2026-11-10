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

/**
 * The type badge's colours come from one table now, so this is only about the
 * card asking for them -- `work-item-type-colors.test.ts` is where the
 * contrast of each pair is measured (#575).
 */
describe('the work item type badge', () => {
  const badgeOf = (type: string) => {
    render(<StandupKanbanCard item={card({ id: 7616, source: undefined, workItemType: type })} />);
    const badge = screen.getByText(type);
    return badge.style;
  };

  it('draws the type in the lifted text colour, not the DevOps hue', () => {
    const style = badgeOf('Enhancement');
    // #c084fc lifted from #773b93, which measured 2.10:1 on a dark card.
    expect(style.color).toBe('rgb(192, 132, 252)');
    expect(style.color).not.toBe('rgb(119, 59, 147)');
  });

  it('still tints the background with the type’s own DevOps hue', () => {
    // #773b93 at the 12.5% the `20` suffix means, which is what the contrast
    // above is measured against.
    expect(badgeOf('Enhancement').backgroundColor).toBe('rgba(119, 59, 147, 0.125)');
  });

  it('gives a custom work item type a real background, not a broken var()', () => {
    // The old fallback built `var(--text-muted)20`, which is not a colour at
    // all: the parser drops the whole declaration, so an unknown type was
    // drawn with no tint. That it parses to an rgba() here is the fix.
    const style = badgeOf('Impediment');
    expect(style.backgroundColor).toBe('rgba(107, 114, 128, 0.125)');
    expect(style.color).toBe('rgb(156, 163, 175)');
  });
});

/** A card with activity in the last 72 working hours but not the last 24 (#586). */
describe('the amber 72-hour highlight', () => {
  const devOpsCard = card({ id: 7701, source: undefined, sourceRef: undefined });

  it('labels the card 72h in dark ink on amber, never white', () => {
    render(<StandupKanbanCard item={devOpsCard} recent />);
    const badge = screen.getByText('72h');
    expect(badge.getAttribute('title')).toBe(
      'Activity in the last 72 working hours, but not the last 24'
    );
    expect(badge.style.backgroundColor).toBe('var(--highlight-recent)');
    expect(badge.style.color).toBe('var(--highlight-recent-foreground)');
  });

  it('describes the card to keyboard and screen-reader users, keeping its name', () => {
    render(<StandupKanbanCard item={devOpsCard} recent onClick={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Open Issue #7701' });
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe(
      'Activity in the last 72 working hours, but not the last 24'
    );
  });

  it('adds no description to a card without the amber highlight', () => {
    render(<StandupKanbanCard item={devOpsCard} onClick={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Open Issue #7701' });
    expect(button.getAttribute('aria-describedby')).toBeNull();
  });

  it('gives way to a 24-hour highlight', () => {
    render(<StandupKanbanCard item={devOpsCard} recent highlight={['updated']} />);
    expect(screen.queryByText('72h')).toBeNull();
    expect(screen.getByText('Updated')).toBeTruthy();
  });
});
