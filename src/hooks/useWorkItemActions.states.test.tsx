// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * The quick view's status menu, like the ticket screen's, offers exactly the
 * states of the work item's own type (#725). A fallback once added Active to
 * every list, so a type without an Active state was offered one it cannot take.
 */
const get = vi.fn();
vi.mock('@/hooks/useDevOpsApi', () => ({ useDevOpsApi: () => ({ get }) }));

import { useWorkItemActions } from './useWorkItemActions';

const state = (name: string, category: string) => ({ name, color: '888888', category });

const answer = (allStates: unknown[]) =>
  new Response(JSON.stringify({ allStates }), { status: 200 });

beforeEach(() => {
  get.mockReset();
});

const openMenu = async (options: Parameters<typeof useWorkItemActions>[0]) => {
  const { result } = renderHook(() => useWorkItemActions(options));
  act(() => result.current.setIsStateDropdownOpen(true));
  await waitFor(() => expect(result.current.isLoadingStates).toBe(false));
  await waitFor(() => expect(get).toHaveBeenCalled());
  await waitFor(() => expect(result.current.isLoadingStates).toBe(false));
  return result;
};

describe('useWorkItemActions states', () => {
  it('a type with no Active state is not offered Active', async () => {
    get.mockResolvedValue(
      answer([state('To Do', 'Proposed'), state('Doing', 'InProgress'), state('Done', 'Completed')])
    );
    const result = await openMenu({ workItemId: 7, project: 'Contoso', workItemType: 'Issue' });

    expect(String(get.mock.calls[0][0])).toContain('type=Issue');
    await waitFor(() =>
      expect(result.current.availableStates.map((s) => s.name)).toEqual(['To Do', 'Doing', 'Done'])
    );
  });

  it('keeps the Active fallback when no type is named', async () => {
    get.mockResolvedValue(answer([state('New', 'Proposed'), state('Closed', 'Completed')]));
    const result = await openMenu({ workItemId: 7, project: 'Contoso' });

    await waitFor(() =>
      expect(result.current.availableStates.map((s) => s.name)).toEqual(['New', 'Active', 'Closed'])
    );
  });

  // The route answers 404/502 for a named type it cannot read, and the menu
  // must say so rather than open on an empty box.
  it('flags a failed load and asks again when reopened', async () => {
    get.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Could not read' }), { status: 502 })
    );
    const result = await openMenu({ workItemId: 7, project: 'Contoso', workItemType: 'Issue' });
    await waitFor(() => expect(result.current.statesLoadFailed).toBe(true));
    expect(result.current.availableStates).toEqual([]);

    get.mockResolvedValue(answer([state('To Do', 'Proposed'), state('Done', 'Completed')]));
    act(() => result.current.setIsStateDropdownOpen(false));
    act(() => result.current.setIsStateDropdownOpen(true));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(result.current.availableStates.map((s) => s.name)).toEqual(['To Do', 'Done'])
    );
    expect(result.current.statesLoadFailed).toBe(false);
  });

  it('flags a thrown request and an empty answer the same way', async () => {
    get.mockRejectedValue(new Error('network down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const thrown = await openMenu({ workItemId: 7, project: 'Contoso', workItemType: 'Issue' });
    await waitFor(() => expect(thrown.current.statesLoadFailed).toBe(true));

    get.mockReset();
    get.mockResolvedValue(answer([]));
    const empty = await openMenu({ workItemId: 7, project: 'Contoso', workItemType: 'Issue' });
    await waitFor(() => expect(empty.current.statesLoadFailed).toBe(true));
  });
});
