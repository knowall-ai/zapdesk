// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useBoardStateChange } from './useBoardStateChange';
import { isStateChangeCancelled } from '@/lib/state-change-cancelled';

/**
 * Dragging a card to a state the process has rules about (#662).
 *
 * The detail page has asked for Approved By and an Approved Date since #651.
 * A board PATCHed straight through, DevOps refused the transition, and the
 * card sprang back wearing the rule's own error with no way to satisfy it.
 *
 * What the board relies on is the promise: it moves the card as you drag,
 * awaits this, and puts the card back if it throws. So the promise must stay
 * pending while the dialog is open, resolve once the state is written, and
 * reject when it is not -- including for a cancel, which the board then rolls
 * back without a toast.
 */

const APPROVED_BY = {
  referenceName: 'Custom.ApprovedBy',
  name: 'Approved By',
  type: 'string',
  isIdentity: true,
};
const APPROVED_DATE = {
  referenceName: 'Custom.ApprovedDate',
  name: 'Approved Date',
  type: 'dateTime',
};

function requirements(fields: unknown[]) {
  return vi.fn(async () => new Response(JSON.stringify({ fields }), { status: 200 }));
}

/** A promise plus the handles to settle it, so a test can hold a write open. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a transition the process asks nothing about', () => {
  it('writes it without opening a dialog', async () => {
    const commit = vi.fn(async () => {});
    const get = requirements([]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    await act(async () => {
      await result.current.requestStateChange(42, 'Active', 'Contoso Ltd');
    });

    expect(commit).toHaveBeenCalledWith(42, 'Active', 'Contoso Ltd');
    expect(result.current.pending).toBeNull();
  });

  // The rules live on the project's process, so without one there is nothing
  // to ask. Going through means the server's own error still speaks (#651).
  it('writes it without even asking when there is no project', async () => {
    const commit = vi.fn(async () => {});
    const get = requirements([APPROVED_BY]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    await act(async () => {
      await result.current.requestStateChange(42, 'Todo');
    });

    expect(get).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledWith(42, 'Todo', undefined);
  });

  // `fetchStateRequirements` fails open, so a board whose rules cannot be read
  // works exactly as it did before this hook existed.
  it('writes it when the rules cannot be read', async () => {
    const commit = vi.fn(async () => {});
    const get = vi.fn(async () => new Response('nope', { status: 500 }));
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    await act(async () => {
      await result.current.requestStateChange(42, 'Todo', 'Contoso Ltd');
    });

    expect(commit).toHaveBeenCalledWith(42, 'Todo', 'Contoso Ltd');
    expect(result.current.pending).toBeNull();
  });
});

describe('a transition with required fields', () => {
  it('asks instead of writing, and names the fields and the state', async () => {
    const commit = vi.fn(async () => {});
    const get = requirements([APPROVED_BY, APPROVED_DATE]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    await act(async () => {
      // Caught because teardown unmounts the hook, and unmounting cancels a
      // pending change rather than leaving the drag dangling for ever. In the
      // app the board's own try/catch around the drag receives it.
      void result.current.requestStateChange(7, 'Todo', 'Contoso Ltd').catch(() => {});
    });

    expect(commit).not.toHaveBeenCalled();
    expect(result.current.pending).toEqual({
      itemId: 7,
      state: 'Todo',
      project: 'Contoso Ltd',
      fields: [APPROVED_BY, APPROVED_DATE],
    });
  });

  // The whole point of the promise: the board holds the card where it was
  // dropped until the dialog is answered, and nothing is written meanwhile.
  it('leaves the drag unsettled while the dialog is open', async () => {
    const commit = vi.fn(async () => {});
    const get = requirements([APPROVED_DATE]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    let settled = false;
    await act(async () => {
      void result.current.requestStateChange(7, 'Todo', 'Contoso Ltd').then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
    });

    expect(settled).toBe(false);
    expect(result.current.pending).not.toBeNull();
  });

  it('writes the values it was given and lets the drag finish', async () => {
    const commit = vi.fn(async () => {});
    const get = requirements([APPROVED_DATE]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    let resolved = false;
    await act(async () => {
      void result.current.requestStateChange(7, 'Todo', 'Contoso Ltd').then(() => {
        resolved = true;
      });
    });
    await act(async () => {
      await result.current.submit({ 'Custom.ApprovedDate': '2026-11-13' });
    });

    expect(commit).toHaveBeenCalledWith(7, 'Todo', 'Contoso Ltd', {
      'Custom.ApprovedDate': '2026-11-13',
    });
    expect(resolved).toBe(true);
    expect(result.current.pending).toBeNull();
  });

  // A rejected write has to reach the board, or the card stays in a column
  // DevOps never accepted and the user is told nothing.
  it('hands a refused write back to the board', async () => {
    const refusal = new Error('TF401320: Rule Error');
    const commit = vi.fn(async () => {
      throw refusal;
    });
    const get = requirements([APPROVED_DATE]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    let caught: unknown;
    await act(async () => {
      void result.current.requestStateChange(7, 'Todo', 'Contoso Ltd').catch((error) => {
        caught = error;
      });
    });
    await act(async () => {
      await result.current.submit({ 'Custom.ApprovedDate': '2026-11-13' });
    });

    expect(caught).toBe(refusal);
    expect(isStateChangeCancelled(caught)).toBe(false);
    expect(result.current.pending).toBeNull();
  });

  it('rejects as a cancel when the dialog is closed', async () => {
    const commit = vi.fn(async () => {});
    const get = requirements([APPROVED_DATE]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    let caught: unknown;
    await act(async () => {
      void result.current.requestStateChange(7, 'Todo', 'Contoso Ltd').catch((error) => {
        caught = error;
      });
    });
    await act(async () => {
      result.current.cancel();
    });

    expect(isStateChangeCancelled(caught)).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    expect(result.current.pending).toBeNull();
  });

  it('reports the write in flight, so the dialog can go quiet', async () => {
    const write = deferred();
    const commit = vi.fn(() => write.promise);
    const get = requirements([APPROVED_DATE]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    await act(async () => {
      void result.current.requestStateChange(7, 'Todo', 'Contoso Ltd');
    });
    expect(result.current.isSubmitting).toBe(false);

    await act(async () => {
      void result.current.submit({ 'Custom.ApprovedDate': '2026-11-13' });
    });
    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      write.resolve();
      await write.promise;
    });
    expect(result.current.isSubmitting).toBe(false);
  });
});

/**
 * A second drag while a dialog is open.
 *
 * Without a guard the newer one replaces `pending`, and the first drag's
 * promise is never settled -- so its card sits in a column DevOps never
 * accepted, for as long as the page is open, with nothing to say so.
 */
describe('a second drag while one is being asked about', () => {
  it('is refused, and leaves the first dialog alone', async () => {
    const commit = vi.fn(async () => {});
    const get = requirements([APPROVED_DATE]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    await act(async () => {
      // Caught because teardown unmounts the hook, and unmounting cancels a
      // pending change rather than leaving the drag dangling for ever. In the
      // app the board's own try/catch around the drag receives it.
      void result.current.requestStateChange(7, 'Todo', 'Contoso Ltd').catch(() => {});
    });

    let caught: unknown;
    await act(async () => {
      await result.current.requestStateChange(8, 'Todo', 'Contoso Ltd').catch((error) => {
        caught = error;
      });
    });

    // Rolled back silently, like any other cancel: the user did not ask for
    // two dialogs and does not need an error about it.
    expect(isStateChangeCancelled(caught)).toBe(true);
    expect(result.current.pending?.itemId).toBe(7);
    expect(commit).not.toHaveBeenCalled();
  });
});
/**
 * A pending change belongs to the organisation it was asked in (#663 review).
 *
 * The work item id travels in the URL and the organisation in a header, so the
 * same id in another organisation is a different item -- and `commit` always
 * reads the newest organisation. Writing one organisation's answers to the
 * other's item is worse than doing nothing, so both paths cancel.
 */
describe('the organisation changing underneath', () => {
  it('cancels a lookup that finished after the switch', async () => {
    const commit = vi.fn(async () => {});
    const open = deferred<Response>();
    const get = vi.fn(() => open.promise);
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) => useBoardStateChange({ get, commit, scope }),
      { initialProps: { scope: 'KnowAll' } }
    );

    let caught: unknown;
    await act(async () => {
      void result.current.requestStateChange(7, 'Todo', 'Contoso Ltd').catch((error) => {
        caught = error;
      });
    });

    // Switch, then let the requirements answer arrive.
    rerender({ scope: 'Other' });
    await act(async () => {
      open.resolve(new Response(JSON.stringify({ fields: [APPROVED_DATE] }), { status: 200 }));
      await open.promise;
    });

    expect(isStateChangeCancelled(caught)).toBe(true);
    expect(result.current.pending).toBeNull();
    expect(commit).not.toHaveBeenCalled();
  });

  // The dialog has no focus trap, so a keyboard user can still reach the
  // organisation switcher behind it.
  it('cancels a dialog left open across the switch', async () => {
    const commit = vi.fn(async () => {});
    const get = requirements([APPROVED_DATE]);
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) => useBoardStateChange({ get, commit, scope }),
      { initialProps: { scope: 'KnowAll' } }
    );

    let caught: unknown;
    await act(async () => {
      void result.current.requestStateChange(7, 'Todo', 'Contoso Ltd').catch((error) => {
        caught = error;
      });
    });
    expect(result.current.pending).not.toBeNull();

    await act(async () => {
      rerender({ scope: 'Other' });
    });

    expect(isStateChangeCancelled(caught)).toBe(true);
    expect(result.current.pending).toBeNull();
    expect(commit).not.toHaveBeenCalled();
  });
});

/**
 * Cancelling once the write is away (#663 review).
 *
 * The PATCH is not aborted, so letting the cancel through would roll the card
 * back to its old column while the write carried on and very likely succeeded
 * -- the board showing one state and the server holding another.
 */
describe('a cancel while the write is in flight', () => {
  it('is ignored, and the write still settles the drag', async () => {
    const write = deferred();
    const commit = vi.fn(() => write.promise);
    const get = requirements([APPROVED_DATE]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    let resolved = false;
    let caught: unknown;
    await act(async () => {
      void result.current.requestStateChange(7, 'Todo', 'Contoso Ltd').then(
        () => {
          resolved = true;
        },
        (error) => {
          caught = error;
        }
      );
    });
    await act(async () => {
      void result.current.submit({ 'Custom.ApprovedDate': '2026-11-13' });
    });

    // Mid-write: the dialog's own buttons are disabled, and this is the
    // guarantee behind them.
    await act(async () => {
      result.current.cancel();
    });
    expect(caught).toBeUndefined();
    expect(result.current.pending).not.toBeNull();

    await act(async () => {
      write.resolve();
      await write.promise;
    });
    expect(resolved).toBe(true);
    expect(result.current.pending).toBeNull();
  });

  it('is accepted again once the write has failed', async () => {
    const commit = vi.fn(async () => {
      throw new Error('TF401320: Rule Error');
    });
    const get = requirements([APPROVED_DATE]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    await act(async () => {
      void result.current.requestStateChange(7, 'Todo', 'Contoso Ltd').catch(() => {});
    });
    await act(async () => {
      await result.current.submit({ 'Custom.ApprovedDate': '2026-11-13' });
    });

    // The flag must not be left set by a failed write, or no dialog could ever
    // be cancelled again for the life of the page.
    let caught: unknown;
    await act(async () => {
      void result.current.requestStateChange(8, 'Todo', 'Contoso Ltd').catch((error) => {
        caught = error;
      });
    });
    await act(async () => {
      result.current.cancel();
    });
    expect(isStateChangeCancelled(caught)).toBe(true);
  });
});

describe('the requirements lookup', () => {
  // Nothing else bounded it: a stalled request left the drag unresolved with
  // no dialog on screen to cancel (#663 review).
  it('is given a deadline', async () => {
    const commit = vi.fn(async () => {});
    const get = requirements([]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    await act(async () => {
      await result.current.requestStateChange(7, 'Todo', 'Contoso Ltd');
    });

    // The helper's mock declares no parameters, so the recorded call is read
    // through a cast rather than giving it unused ones.
    const [, options] = get.mock.calls[0] as unknown as [string, { signal?: AbortSignal }];
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });
});
