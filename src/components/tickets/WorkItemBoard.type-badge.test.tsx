// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import WorkItemBoard, { TICKET_COLUMNS } from './WorkItemBoard';
import type { WorkItem, WorkItemType } from '@/types';

// A ticket changed to a type nothing else on the board had -- Bug, usually --
// kept its name but lost its icon and colour until a hard reload (#647). The
// icons were taken from the same narrowed list as the type filter, so a type
// had to already be on the board before it could be drawn.

const item = (id: number, workItemType: string, title: string): WorkItem => ({
  id,
  title,
  description: '',
  state: 'Active',
  workItemType,
  areaPath: 'Contoso Ltd',
  project: 'Contoso Ltd',
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-02T00:00:00Z'),
  completedWork: 0,
  remainingWork: 0,
  originalEstimate: 0,
  devOpsUrl: `https://dev.azure.com/x/_workitems/edit/${id}`,
  tags: ['ticket'],
});

/** Every type the project defines, as the types endpoint gives them. */
const PROJECT_TYPES: WorkItemType[] = [
  {
    name: 'Task',
    referenceName: 'Microsoft.VSTS.WorkItemTypes.Task',
    color: 'f2cb1d',
    icon: 'https://example.com/task.svg',
  },
  {
    name: 'Bug',
    referenceName: 'Microsoft.VSTS.WorkItemTypes.Bug',
    color: 'cc293d',
    icon: 'https://example.com/bug.svg',
  },
  {
    name: 'User Story',
    referenceName: 'Microsoft.VSTS.WorkItemTypes.UserStory',
    color: '009ccc',
    icon: 'https://example.com/story.svg',
  },
];

const board = (items: WorkItem[]) =>
  render(
    <WorkItemBoard
      items={items}
      columns={TICKET_COLUMNS}
      availableTypes={PROJECT_TYPES}
      hideTicketsOnlyToggle
      defaultTicketsOnly={false}
    />
  );

/** The type badge in the row holding `title`, found by the name it shows. */
const badgeFor = (title: string, typeName: string): HTMLElement => {
  const row = screen.getByText(title).closest('tr');
  if (!row) throw new Error(`no row for ${title}`);
  const badge = [...row.querySelectorAll('span')].find((s) => s.textContent?.trim() === typeName);
  if (!badge) throw new Error(`no ${typeName} badge in the row for ${title}`);
  return badge as HTMLElement;
};

describe('WorkItemBoard: a type badge is drawn from the project, not the board (#647)', () => {
  afterEach(cleanup);

  // The state right after a type change: one Bug among Tasks. This is exactly
  // the case that used to render bare.
  it('draws icon and colour for a type no other item on the board has', () => {
    board([item(1, 'Task', 'Printer on fire'), item(2, 'Bug', 'Cannot sign in')]);
    const badge = badgeFor('Cannot sign in', 'Bug');
    // jsdom normalises the hex, which also shows the colour parsed at all.
    expect(badge.style.borderLeft).toBe('3px solid rgb(204, 41, 61)');
    expect(badge.querySelector('img')?.getAttribute('src')).toBe('https://example.com/bug.svg');
  });

  it('still draws a type that was there all along', () => {
    board([item(1, 'Task', 'Printer on fire')]);
    expect(badgeFor('Printer on fire', 'Task').style.borderLeft).toBe(
      '3px solid rgb(242, 203, 29)'
    );
  });

  it('leaves the badge plain for a type the project does not define', () => {
    // No colour invented: an unknown type still reads as its name.
    board([item(1, 'Impediment', 'Blocked on a third party')]);
    const badge = badgeFor('Blocked on a third party', 'Impediment');
    expect(badge.style.borderLeft).toBe('');
    expect(badge.querySelector('img')).toBeNull();
  });

  it('offers only the types on the board in the type filter', () => {
    // The filter is over the board, so User Story -- which the project defines
    // but the board is not showing -- must not be offered. That narrowing is
    // what the icons used to be tied to, and it stays.
    board([item(1, 'Task', 'Printer on fire'), item(2, 'Bug', 'Cannot sign in')]);
    fireEvent.click(screen.getByRole('button', { name: /All Types/ }));
    expect(screen.getByLabelText('Bug')).toBeTruthy();
    expect(screen.getByLabelText('Task')).toBeTruthy();
    expect(screen.queryByLabelText('User Story')).toBeNull();
  });
});
