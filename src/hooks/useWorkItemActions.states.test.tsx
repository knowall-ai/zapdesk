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
});
