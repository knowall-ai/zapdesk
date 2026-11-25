// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import type { DragEndEvent } from '@dnd-kit/core';
import type { Ticket } from '@/types';

/**
 * Dropping a ticket on a Tickets board column whose state its own process
 * does not have. The columns come from one process; a Scrum project's ticket
 * has Done, not Closed, and DevOps refused "Closed" for it.
 */

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m) } }));

/** The board's drop handler, captured from the drag context. */
let onDragEnd: ((event: DragEndEvent) => void | Promise<void>) | undefined;
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    DndContext: (props: { children: React.ReactNode; onDragEnd?: typeof onDragEnd }) => {
      onDragEnd = props.onDragEnd;
      return <actual.DndContext>{props.children}</actual.DndContext>;
    },
  };
});

import KanbanBoard from './KanbanBoard';

const COLUMNS = [
  { name: 'New', color: '', category: 'Proposed' },
  { name: 'Active', color: '', category: 'InProgress' },
  { name: 'Resolved', color: '', category: 'Resolved' },
  { name: 'Closed', color: '', category: 'Completed' },
];
const SCRUM_TASK = [
  { name: 'To Do', category: 'Proposed' },
  { name: 'In Progress', category: 'InProgress' },
  { name: 'Done', category: 'Completed' },
];
const TASK = [
  { name: 'New', category: 'Proposed' },
  { name: 'Active', category: 'InProgress' },
  { name: 'Closed', category: 'Completed' },
];

const ticket = (id: number, project: string, state: string): Ticket =>
  ({
    id,
    title: `Ticket ${id}`,
    project,
    devOpsState: state,
    workItemType: 'Task',
    status: 'Open',
    tags: ['ticket'],
    createdAt: new Date('2026-11-01'),
    updatedAt: new Date('2026-11-02'),
  }) as unknown as Ticket;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = new URL(url, 'https://zapdesk.test');
      const project = u.searchParams.get('project');
      if (!project) return new Response(JSON.stringify({ allStates: COLUMNS }));
      const states = project === 'Fabrikam' ? SCRUM_TASK : TASK;
      return new Response(
        JSON.stringify({ statesByType: [{ workItemType: 'Task', states }], allStates: [] })
      );
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  toastError.mockReset();
  onDragEnd = undefined;
});

const drop = (id: number, column: string) =>
  act(async () => {
    await onDragEnd?.({ active: { id }, over: { id: column } } as unknown as DragEndEvent);
  });

async function renderBoard(tickets: Ticket[]) {
  const onTicketStateChange = vi.fn(async () => {});
  render(
    <KanbanBoard tickets={tickets} onTicketStateChange={onTicketStateChange} organization="Org" />
  );
  // Columns, then each project's states, have loaded.
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(3));
  await act(async () => {});
  return onTicketStateChange;
}

describe('Tickets board drop', () => {
  it('moves a Scrum ticket dropped on Closed to its own Done state', async () => {
    const onChange = await renderBoard([
      ticket(1, 'Fabrikam', 'In Progress'),
      ticket(2, 'Contoso', 'Active'),
    ]);

    await drop(1, 'Closed');

    expect(onChange).toHaveBeenCalledWith(1, 'Done', 'Fabrikam');
  });

  it('still sends Closed for a ticket whose type has it', async () => {
    const onChange = await renderBoard([
      ticket(1, 'Fabrikam', 'In Progress'),
      ticket(2, 'Contoso', 'Active'),
    ]);

    await drop(2, 'Closed');

    expect(onChange).toHaveBeenCalledWith(2, 'Closed', 'Contoso');
  });

  it('refuses a column the type has no state for, without writing', async () => {
    const onChange = await renderBoard([
      ticket(1, 'Fabrikam', 'In Progress'),
      ticket(2, 'Contoso', 'Active'),
    ]);

    await drop(2, 'Resolved');

    expect(onChange).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Task in Contoso has no "Resolved" state');
  });
});
