// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { Ticket } from '@/types';
import { MAX_TITLE_LENGTH } from '@/lib/ticket-title';

/**
 * Renaming a ticket from the ticket screen (7772). Customers often raise a
 * ticket with a subject that says nothing, and the title is what every list,
 * board and email then shows.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tickets/7',
}));

vi.mock('@/hooks/useMentionableUsers', () => ({
  useMentionableUsers: () => ({ users: [], loading: false }),
}));

// The screen and its children read the selected organisation; one stub covers
// all of them without standing up the provider's own fetching.
vi.mock('@/components/providers/OrganizationProvider', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
  useOrganization: () => ({
    organizations: [],
    selectedOrganization: { name: 'KnowAll', id: 'org1' },
    setSelectedOrganization: () => {},
    isLoading: false,
    error: null,
    refetch: async () => {},
  }),
}));

import TicketDetail from './TicketDetail';

const ticket = (overrides: Partial<Ticket> = {}): Ticket =>
  ({
    id: 7,
    workItemId: 7,
    title: 'FW: question',
    description: '',
    status: 'open',
    devOpsState: 'Active',
    workItemType: 'Task',
    requester: {
      id: 'c1',
      displayName: 'Dana',
      email: 'dana@example.test',
      timezone: 'Europe/London',
      tags: [],
    },
    tags: ['ticket'],
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-02T00:00:00Z'),
    devOpsUrl: 'https://dev.azure.test/item/7',
    project: 'Internal',
    comments: [],
    ...overrides,
  }) as unknown as Ticket;

const show = (onTitleChange?: (title: string) => Promise<void>, title?: string) =>
  render(
    <TicketDetail
      ticket={title === undefined ? ticket() : ticket({ title })}
      comments={[]}
      onTitleChange={onTitleChange}
    />
  );

const openEditor = () => fireEvent.click(screen.getByRole('button', { name: 'Edit title' }));
const input = () => screen.getByRole('textbox', { name: 'Ticket title' });
const saveButton = () => screen.getByRole('button', { name: /^Save/ });

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]', { status: 200 }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TicketDetail title editing', () => {
  it('offers no way in when the reader may not rename the ticket', () => {
    // The screen is shared with views that pass no handler.
    show();
    expect(screen.queryByRole('button', { name: 'Edit title' })).toBeNull();
  });

  it('opens with the current title, ready to be replaced', () => {
    show(async () => {});
    openEditor();
    expect((input() as HTMLInputElement).value).toBe('FW: question');
  });

  it('saves the new title, trimmed', async () => {
    const onTitleChange = vi.fn(async () => {});
    show(onTitleChange);
    openEditor();
    fireEvent.change(input(), { target: { value: '  Cannot print from Leeds  ' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(onTitleChange).toHaveBeenCalledWith('Cannot print from Leeds'));
  });

  it('saves on Enter, so renaming never needs the mouse', async () => {
    const onTitleChange = vi.fn(async () => {});
    show(onTitleChange);
    openEditor();
    fireEvent.change(input(), { target: { value: 'Cannot print' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(onTitleChange).toHaveBeenCalledWith('Cannot print'));
  });

  it('ignores Enter while an input method is composing', () => {
    // An IME uses Enter to accept the candidate it is offering. Saving then
    // commits half a title and closes the editor under the person typing.
    const onTitleChange = vi.fn(async () => {});
    show(onTitleChange);
    openEditor();
    fireEvent.change(input(), { target: { value: 'プリンタ' } });
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });

    expect(onTitleChange).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Ticket title' })).toBeDefined();
  });

  it('saves on the Enter that follows, once composition has ended', async () => {
    const onTitleChange = vi.fn(async () => {});
    show(onTitleChange);
    openEditor();
    fireEvent.change(input(), { target: { value: 'プリンタが動かない' } });
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input(), { key: 'Enter' });

    await waitFor(() => expect(onTitleChange).toHaveBeenCalledWith('プリンタが動かない'));
  });

  it('keeps the editor and draft when Escape only cancels composition', () => {
    // An IME uses Escape to drop the candidate it is offering, not the edit.
    const onTitleChange = vi.fn(async () => {});
    show(onTitleChange);
    openEditor();
    fireEvent.change(input(), { target: { value: 'プリンタ' } });
    fireEvent.keyDown(input(), { key: 'Escape', isComposing: true });

    expect(onTitleChange).not.toHaveBeenCalled();
    expect((input() as HTMLInputElement).value).toBe('プリンタ');
  });

  it('abandons the edit on Escape without saving', () => {
    const onTitleChange = vi.fn(async () => {});
    show(onTitleChange);
    openEditor();
    fireEvent.change(input(), { target: { value: 'Something else' } });
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(onTitleChange).not.toHaveBeenCalled();
    expect(screen.getByText('FW: question')).toBeDefined();
  });

  it('refuses an empty title and says why, rather than letting the server refuse it', () => {
    const onTitleChange = vi.fn(async () => {});
    show(onTitleChange);
    openEditor();
    fireEvent.change(input(), { target: { value: '   ' } });
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('A title is required.')).toBeDefined();
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onTitleChange).not.toHaveBeenCalled();
  });

  it('refuses a title longer than DevOps accepts, saying the limit', () => {
    show(async () => {});
    openEditor();
    fireEvent.change(input(), { target: { value: 'x'.repeat(MAX_TITLE_LENGTH + 1) } });
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(new RegExp(`${MAX_TITLE_LENGTH} characters or fewer`))).toBeDefined();
  });

  it('will not save a title nobody changed', () => {
    show(async () => {});
    openEditor();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('treats a stored title with padding as unchanged', () => {
    // Titles saved before the route trimmed them still carry it. Comparing the
    // draft against the untrimmed stored value offers to save an edit nobody
    // made, the moment the editor opens.
    show(async () => {}, '  FW: question  ');
    openEditor();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('puts focus back on the Edit control after Escape', () => {
    // The input the reader was on has gone. Leaving focus on the body drops a
    // keyboard reader back at the top of the page.
    show(async () => {});
    const pencil = screen.getByRole('button', { name: 'Edit title' });
    fireEvent.click(pencil);
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit title' }));
  });

  it('puts focus back on the Edit control after a save', async () => {
    const onTitleChange = vi.fn(async () => {});
    show(onTitleChange);
    openEditor();
    fireEvent.change(input(), { target: { value: 'Cannot print' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(onTitleChange).toHaveBeenCalled());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit title' }))
    );
  });

  it('leaves focus alone on first render', () => {
    // Guards the obvious wrong fix: an effect that fires whenever the editor
    // is closed would grab focus the moment a ticket is opened.
    show(async () => {});
    expect(document.activeElement).toBe(document.body);
  });

  it('stays open when the save fails, so the typing is not lost', async () => {
    const onTitleChange = vi.fn(async () => {
      throw new Error('DevOps said no');
    });
    show(onTitleChange);
    openEditor();
    fireEvent.change(input(), { target: { value: 'Cannot print' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(onTitleChange).toHaveBeenCalled());
    expect((input() as HTMLInputElement).value).toBe('Cannot print');
  });
});
