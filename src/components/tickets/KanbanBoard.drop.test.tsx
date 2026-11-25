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

  // #687 review: an earlier move of the card, still waiting on its dialog,
  // must stand down when a later drop of it is refused.
  it('stands down an earlier move of the card when a drop is refused', async () => {
    const onAbandoned = vi.fn();
    render(
      <KanbanBoard
        tickets={[ticket(2, 'Contoso', 'Active')]}
        onTicketStateChange={vi.fn(async () => {})}
        onStateChangeAbandoned={onAbandoned}
        organization="Org"
      />
    );
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(2));
    await act(async () => {});

    await drop(2, 'Resolved');

    expect(onAbandoned).toHaveBeenCalledWith(2);
  });

  // #687 review: the route skips a type whose lookup failed and still answers
  // 200. The board asks again, but not for ever.
  it('asks again for a type the answer left out, a bounded number of times', async () => {
    const stateCalls = () =>
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('project=')).length;
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url).includes('project=')
        ? new Response(JSON.stringify({ statesByType: [], allStates: [] }))
        : new Response(JSON.stringify({ allStates: COLUMNS }))
    );
    const props = { onTicketStateChange: vi.fn(async () => {}), organization: 'Org' };
    const { rerender } = render(
      <KanbanBoard tickets={[ticket(1, 'Fabrikam', 'In Progress')]} {...props} />
    );
    await waitFor(() => expect(stateCalls()).toBe(1));

    // Each new list of tickets from the parent is a chance to ask again.
    for (let i = 0; i < 5; i++) {
      rerender(<KanbanBoard tickets={[ticket(1, 'Fabrikam', 'In Progress')]} {...props} />);
      await act(async () => {});
    }

    expect(stateCalls()).toBe(3);
  });

  // #687 review: states belong to the organisation they were read from. After
  // a switch whose lookup fails, the old organisation's Scrum states must not
  // turn a drop on Closed into Done.
  it("does not use another organisation's states", async () => {
    const onChange = vi.fn(async () => {});
    const tickets = [ticket(1, 'Fabrikam', 'In Progress')];
    const { rerender } = render(
      <KanbanBoard tickets={tickets} onTicketStateChange={onChange} organization="OrgA" />
    );
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(2));
    await act(async () => {});

    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url).includes('project=')
        ? new Response('{}', { status: 500 })
        : new Response(JSON.stringify({ allStates: COLUMNS }))
    );
    rerender(<KanbanBoard tickets={tickets} onTicketStateChange={onChange} organization="OrgB" />);
    await act(async () => {});

    await drop(1, 'Closed');

    expect(onChange).toHaveBeenCalledWith(1, 'Closed', 'Fabrikam');
  });
});
