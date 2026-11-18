// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useBoardStateChange } from './useBoardStateChange';
import { isStateChangeCancelled, isStateChangeSuperseded } from '@/lib/state-change-cancelled';
import { MissingFieldsError } from '@/lib/missing-fields-error';

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

  // The dialog keeps focus inside itself, but the organisation can still
  // change from outside it -- another tab, a session refresh.
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
  // A lookup that never answers is released by its deadline, and the move
  // is then attempted once. A signal that never fires would leave this
  // test waiting, which is the point: an AbortSignal alone proves nothing.
  it('is given a deadline that releases a stalled lookup', async () => {
    // The deadline's own timer is the runtime's, not one a fake clock moves,
    // so it is taken over here: the test fires it, and checks its length.
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const commit = vi.fn(async () => {});
    const get = vi.fn(
      (_url: string, options?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    let done = false;
    await act(async () => {
      void result.current.requestStateChange(7, 'Todo', 'Contoso Ltd').then(() => {
        done = true;
      });
    });
    expect(timeout).toHaveBeenCalledWith(10_000);
    // A lookup that never answers holds the move...
    expect(commit).not.toHaveBeenCalled();

    // ...until its deadline passes. Then the move is attempted, once.
    await act(async () => {
      deadline.abort();
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(7, 'Todo', 'Contoso Ltd');
    expect(done).toBe(true);
  });
});
describe('the page going away mid-lookup', () => {
  // The unmount cleanup calls `cancel`, but there is nothing to cancel yet:
  // `settleRef` is only set once the dialog opens. Without a mount check the
  // drag's promise waits for a submit that can never come (#663 review).
  it('cancels a lookup that answers after unmount', async () => {
    const commit = vi.fn(async () => {});
    const open = deferred<Response>();
    const get = vi.fn(() => open.promise);
    const { result, unmount } = renderHook(() => useBoardStateChange({ get, commit }));

    let caught: unknown;
    const drag = result.current.requestStateChange(7, 'Todo', 'Contoso Ltd').catch((error) => {
      caught = error;
    });

    unmount();
    await act(async () => {
      open.resolve(new Response(JSON.stringify({ fields: [APPROVED_DATE] }), { status: 200 }));
      await drag;
    });

    expect(isStateChangeCancelled(caught)).toBe(true);
    expect(commit).not.toHaveBeenCalled();
  });
});

/**
 * The scope check sits above the commit, not below it (#663 review).
 *
 * A transition needing no fields was otherwise written with the drag's own
 * closure, so a switch during the lookup sent the PATCH to the organisation
 * the drag began in and popped its success toast over the new one.
 */
describe('a switch during the lookup for a transition that needs nothing', () => {
  it('writes nothing', async () => {
    const commit = vi.fn(async () => {});
    const open = deferred<Response>();
    const get = vi.fn(() => open.promise);
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) => useBoardStateChange({ get, commit, scope }),
      { initialProps: { scope: 'KnowAll' } }
    );

    let caught: unknown;
    await act(async () => {
      void result.current.requestStateChange(7, 'Active', 'Contoso Ltd').catch((error) => {
        caught = error;
      });
    });

    rerender({ scope: 'Other' });
    await act(async () => {
      open.resolve(new Response(JSON.stringify({ fields: [] }), { status: 200 }));
      await open.promise;
    });

    expect(commit).not.toHaveBeenCalled();
    expect(isStateChangeCancelled(caught)).toBe(true);
  });
});

/**
 * The same card dragged again before its first lookup answered (#663 review).
 *
 * The card stays draggable while a lookup is away. If the first drag's lookup
 * answered last, its older state would be written last and kept, with nothing
 * said. Only the newest drag of an item may write.
 */
describe('a newer drag of the same card during the lookup', () => {
  it('stands the older drag down, and writes only the newer one', async () => {
    const commit = vi.fn(async () => {});
    const first = deferred<Response>();
    const second = deferred<Response>();
    const get = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    let olderError: unknown;
    let newerDone = false;
    await act(async () => {
      void result.current.requestStateChange(7, 'Active', 'Contoso Ltd').catch((error) => {
        olderError = error;
      });
      void result.current.requestStateChange(7, 'Resolved', 'Contoso Ltd').then(() => {
        newerDone = true;
      });
    });

    // The newer lookup answers first and writes; the older answers last.
    await act(async () => {
      second.resolve(new Response(JSON.stringify({ fields: [] }), { status: 200 }));
      await second.promise;
    });
    await act(async () => {
      first.resolve(new Response(JSON.stringify({ fields: [] }), { status: 200 }));
      await first.promise;
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(7, 'Resolved', 'Contoso Ltd');
    expect(newerDone).toBe(true);
    // Marked superseded, so the board leaves the card where the newer drag put it.
    expect(isStateChangeSuperseded(olderError)).toBe(true);
  });

  // Card 7's write is held open; card 8's must finish regardless. A single
  // queue for every card would keep 8 waiting behind 7.
  it('does not hold back a drag of a different card', async () => {
    const sevenWrite = deferred();
    const commit = vi.fn(async (id: number) => {
      if (id === 7) await sevenWrite.promise;
    });
    const get = requirements([]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    let sevenDone = false;
    let eightDone = false;
    await act(async () => {
      void result.current.requestStateChange(7, 'Active', 'Contoso Ltd').then(() => {
        sevenDone = true;
      });
      void result.current.requestStateChange(8, 'Resolved', 'Contoso Ltd').then(() => {
        eightDone = true;
      });
    });

    expect(eightDone).toBe(true);
    expect(sevenDone).toBe(false);

    await act(async () => {
      sevenWrite.resolve();
      await sevenWrite.promise;
    });
    expect(sevenDone).toBe(true);
  });

  // A drag stood down for a newer one is a cancel, but not one to roll back.
  it('marks only that case as superseded', async () => {
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
    expect(isStateChangeSuperseded(caught)).toBe(false);
  });
});

describe('a card dropped back where it started during the lookup', () => {
  // Leave New for Active, then put it back in New before the lookup answers.
  // The last drop is the one the user means, so Active must not be written.
  it('stands the earlier drag down without writing', async () => {
    const commit = vi.fn(async () => {});
    const lookup = deferred<Response>();
    const get = vi.fn().mockReturnValueOnce(lookup.promise);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    let caught: unknown;
    await act(async () => {
      void result.current.requestStateChange(7, 'Active', 'Contoso Ltd').catch((error) => {
        caught = error;
      });
    });
    act(() => result.current.supersede(7));
    await act(async () => {
      lookup.resolve(new Response(JSON.stringify({ fields: [] }), { status: 200 }));
      await lookup.promise;
    });

    expect(commit).not.toHaveBeenCalled();
    expect(isStateChangeSuperseded(caught)).toBe(true);
  });

  it('leaves other cards alone', async () => {
    const commit = vi.fn(async () => {});
    const lookup = deferred<Response>();
    const get = vi.fn().mockReturnValueOnce(lookup.promise);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    let done = false;
    await act(async () => {
      void result.current.requestStateChange(7, 'Active', 'Contoso Ltd').then(() => {
        done = true;
      });
    });
    act(() => result.current.supersede(8));
    await act(async () => {
      lookup.resolve(new Response(JSON.stringify({ fields: [] }), { status: 200 }));
      await lookup.promise;
    });

    expect(commit).toHaveBeenCalledWith(7, 'Active', 'Contoso Ltd');
    expect(done).toBe(true);
  });
});

describe('writes of the same card', () => {
  it('run one after the other, in the order they were made', async () => {
    const order: string[] = [];
    const firstWrite = deferred();
    const commit = vi.fn(async (_id: number, state: string) => {
      order.push(`start ${state}`);
      if (state === 'Active') await firstWrite.promise;
      order.push(`end ${state}`);
    });
    const get = requirements([]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    // A drag, then a second drag of the same card once the first is writing.
    let first!: Promise<void>;
    await act(async () => {
      first = result.current.requestStateChange(7, 'Active', 'Contoso Ltd');
    });
    let second!: Promise<void>;
    await act(async () => {
      second = result.current.requestStateChange(7, 'Resolved', 'Contoso Ltd');
    });
    // The second must not start while the first is still away.
    expect(order).toEqual(['start Active']);

    await act(async () => {
      firstWrite.resolve();
      await first;
      await second;
    });
    expect(order).toEqual(['start Active', 'end Active', 'start Resolved', 'end Resolved']);
  });
});

describe('a refusal that names the fields it wanted', () => {
  // The rules lookup fails open -- process rules need a permission an
  // ordinary user may not hold -- so the move goes out with nothing and
  // DevOps refuses it, naming the fields. The dialog asks for those instead
  // of the board showing the TF401320 rule error (#663).
  it('opens the dialog for them, and writes the answers', async () => {
    const commit = vi
      .fn()
      .mockRejectedValueOnce(
        new MissingFieldsError('TF401320: Rule Error', [APPROVED_BY, APPROVED_DATE])
      )
      .mockResolvedValueOnce(undefined);
    const get = vi.fn(
      async () => new Response(JSON.stringify({ fields: [], unavailable: true }), { status: 200 })
    );
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    let done = false;
    let caught: unknown;
    await act(async () => {
      void result.current
        .requestStateChange(7, 'Active', 'Contoso Ltd')
        .then(() => {
          done = true;
        })
        .catch((error) => {
          caught = error;
        });
    });

    expect(caught).toBeUndefined();
    expect(result.current.pending).toEqual({
      itemId: 7,
      state: 'Active',
      project: 'Contoso Ltd',
      fields: [APPROVED_BY, APPROVED_DATE],
    });

    const answers = {
      'Custom.ApprovedBy': 'Alex Morgan <alex@example.com>',
      'Custom.ApprovedDate': '2026-11-18',
    };
    await act(async () => {
      await result.current.submit(answers);
    });

    expect(commit).toHaveBeenLastCalledWith(7, 'Active', 'Contoso Ltd', answers);
    expect(done).toBe(true);
    expect(result.current.pending).toBeNull();
  });

  it('passes any other failure straight to the board', async () => {
    const refusal = new Error('TF401320: Rule Error for field State');
    const commit = vi.fn().mockRejectedValueOnce(refusal);
    const get = requirements([]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    let caught: unknown;
    await act(async () => {
      await result.current.requestStateChange(7, 'Active', 'Contoso Ltd').catch((error) => {
        caught = error;
      });
    });

    expect(caught).toBe(refusal);
    expect(result.current.pending).toBeNull();
  });

  // The lookup found Approved By but not the second field the rule wanted.
  // Throwing the answers away for a rule error would make the user start
  // again; the missing field is added and the dialog stays open instead.
  it('adds a field the dialog did not ask for, and keeps the dialog open', async () => {
    const commit = vi
      .fn()
      .mockRejectedValueOnce(
        new MissingFieldsError('TF401320: Rule Error', [APPROVED_BY, APPROVED_DATE])
      )
      .mockResolvedValueOnce(undefined);
    const get = requirements([APPROVED_BY]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    let done = false;
    let caught: unknown;
    await act(async () => {
      void result.current
        .requestStateChange(7, 'Active', 'Contoso Ltd')
        .then(() => {
          done = true;
        })
        .catch((error) => {
          caught = error;
        });
    });

    await act(async () => {
      await result.current.submit({ 'Custom.ApprovedBy': 'Alex Morgan <alex@example.com>' });
    });

    expect(caught).toBeUndefined();
    expect(done).toBe(false);
    expect(result.current.pending?.fields).toEqual([APPROVED_BY, APPROVED_DATE]);
    expect(result.current.isSubmitting).toBe(false);

    await act(async () => {
      await result.current.submit({
        'Custom.ApprovedBy': 'Alex Morgan <alex@example.com>',
        'Custom.ApprovedDate': '2026-11-18',
      });
    });
    expect(done).toBe(true);
    expect(result.current.pending).toBeNull();
  });

  it('rolls back when the refusal names only fields already asked for', async () => {
    const refusal = new MissingFieldsError('TF401320: Rule Error', [APPROVED_BY]);
    const commit = vi.fn().mockRejectedValueOnce(refusal);
    const get = requirements([APPROVED_BY]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    let caught: unknown;
    await act(async () => {
      void result.current.requestStateChange(7, 'Active', 'Contoso Ltd').catch((error) => {
        caught = error;
      });
    });
    await act(async () => {
      await result.current.submit({ 'Custom.ApprovedBy': 'Sam Taylor <sam@example.com>' });
    });

    expect(caught).toBe(refusal);
    expect(result.current.pending).toBeNull();
  });

  it('opens nothing when the organisation changed meanwhile', async () => {
    const write = deferred();
    const commit = vi.fn(() =>
      write.promise.then(() => {
        throw new MissingFieldsError('TF401320: Rule Error', [APPROVED_BY]);
      })
    );
    const get = requirements([]);
    const { result, rerender } = renderHook(
      ({ scope }) => useBoardStateChange({ get, commit, scope }),
      { initialProps: { scope: 'KnowAllTest' } }
    );

    let caught: unknown;
    await act(async () => {
      void result.current.requestStateChange(7, 'Active', 'Contoso Ltd').catch((error) => {
        caught = error;
      });
    });
    rerender({ scope: 'Fabrikam' });
    await act(async () => {
      write.resolve();
      await write.promise.catch(() => {});
    });

    expect(isStateChangeCancelled(caught)).toBe(true);
    expect(result.current.pending).toBeNull();
  });
});

describe('a write waiting behind another write of the same card', () => {
  // Active is being written and Resolved waits behind it. The card is then
  // dropped back where it started. Resolved was checked when it was queued,
  // but the move no longer stands by the time its turn comes (#663 review).
  it('is not sent once the card has been dropped back', async () => {
    const activeWrite = deferred();
    const commit = vi.fn(async (_id: number, state: string) => {
      if (state === 'Active') await activeWrite.promise;
    });
    const get = requirements([]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    let resolvedError: unknown;
    await act(async () => {
      void result.current.requestStateChange(7, 'Active', 'Contoso Ltd');
    });
    await act(async () => {
      void result.current.requestStateChange(7, 'Resolved', 'Contoso Ltd').catch((error) => {
        resolvedError = error;
      });
    });
    act(() => result.current.supersede(7));
    await act(async () => {
      activeWrite.resolve();
      await activeWrite.promise;
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(7, 'Active', 'Contoso Ltd');
    expect(isStateChangeSuperseded(resolvedError)).toBe(true);
  });

  it('is not sent once the organisation has changed', async () => {
    const activeWrite = deferred();
    const commit = vi.fn(async (_id: number, state: string) => {
      if (state === 'Active') await activeWrite.promise;
    });
    const get = requirements([]);
    const { result, rerender } = renderHook(
      ({ scope }) => useBoardStateChange({ get, commit, scope }),
      { initialProps: { scope: 'KnowAllTest' } }
    );

    let resolvedError: unknown;
    await act(async () => {
      void result.current.requestStateChange(7, 'Active', 'Contoso Ltd');
    });
    await act(async () => {
      void result.current.requestStateChange(7, 'Resolved', 'Contoso Ltd').catch((error) => {
        resolvedError = error;
      });
    });
    rerender({ scope: 'Fabrikam' });
    await act(async () => {
      activeWrite.resolve();
      await activeWrite.promise;
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(isStateChangeCancelled(resolvedError)).toBe(true);
  });
});

describe('a submission refused for a new field after an organisation switch', () => {
  // The dialog's answers belong to the organisation it opened in. Kept open
  // after a switch, the next confirm would go out with the new organisation's
  // header, to whatever this id names there (#663 review).
  it('settles the drag as cancelled instead of keeping the dialog open', async () => {
    const write = deferred();
    const commit = vi.fn(() =>
      write.promise.then(() => {
        throw new MissingFieldsError('TF401320: Rule Error', [APPROVED_BY, APPROVED_DATE]);
      })
    );
    const get = requirements([APPROVED_BY]);
    const { result, rerender } = renderHook(
      ({ scope }) => useBoardStateChange({ get, commit, scope }),
      { initialProps: { scope: 'KnowAllTest' } }
    );

    let caught: unknown;
    await act(async () => {
      void result.current.requestStateChange(7, 'Active', 'Contoso Ltd').catch((error) => {
        caught = error;
      });
    });
    let submitting!: Promise<void>;
    await act(async () => {
      submitting = result.current.submit({ 'Custom.ApprovedBy': 'Alex Morgan <alex@example.com>' });
    });
    rerender({ scope: 'Fabrikam' });
    await act(async () => {
      write.resolve();
      await submitting;
    });

    expect(isStateChangeCancelled(caught)).toBe(true);
    expect(result.current.pending).toBeNull();
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

describe('later review on #663', () => {
  // A move with no project skips the lookup, but not the queue's checks:
  // dropping the card back still stops a queued write of it.
  it('stands down a queued move with no project once the card is dropped back', async () => {
    const activeWrite = deferred();
    const commit = vi.fn(async (_id: number, state: string) => {
      if (state === 'Active') await activeWrite.promise;
    });
    const get = requirements([]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    let queuedError: unknown;
    await act(async () => {
      void result.current.requestStateChange(7, 'Active');
    });
    await act(async () => {
      void result.current.requestStateChange(7, 'Resolved').catch((error) => {
        queuedError = error;
      });
    });
    act(() => result.current.supersede(7));
    await act(async () => {
      activeWrite.resolve();
      await activeWrite.promise;
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(isStateChangeSuperseded(queuedError)).toBe(true);
  });

  // A -> B -> A: the organisation name is the same again, but the board the
  // move came from is not. A queued write from before must not go out.
  it('does not send a queued write after switching away and back', async () => {
    const activeWrite = deferred();
    const commit = vi.fn(async (_id: number, state: string) => {
      if (state === 'Active') await activeWrite.promise;
    });
    const get = requirements([]);
    const { result, rerender } = renderHook(
      ({ scope }) => useBoardStateChange({ get, commit, scope }),
      { initialProps: { scope: 'KnowAllTest' } }
    );

    let queuedError: unknown;
    await act(async () => {
      void result.current.requestStateChange(7, 'Active', 'Contoso Ltd');
    });
    await act(async () => {
      void result.current.requestStateChange(7, 'Resolved', 'Contoso Ltd').catch((error) => {
        queuedError = error;
      });
    });
    rerender({ scope: 'Fabrikam' });
    rerender({ scope: 'KnowAllTest' });
    await act(async () => {
      activeWrite.resolve();
      await activeWrite.promise;
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(isStateChangeCancelled(queuedError)).toBe(true);
  });

  it('still writes a move that stayed in its organisation', async () => {
    const commit = vi.fn(async () => {});
    const get = requirements([]);
    const { result, rerender } = renderHook(
      ({ scope }) => useBoardStateChange({ get, commit, scope }),
      { initialProps: { scope: 'KnowAllTest' } }
    );
    rerender({ scope: 'KnowAllTest' });

    await act(async () => {
      await result.current.requestStateChange(7, 'Active', 'Contoso Ltd');
    });
    expect(commit).toHaveBeenCalledWith(7, 'Active', 'Contoso Ltd');
  });

  // The dialog's answers are for the drag that opened it. If that drag has
  // been stood down, confirming must not write the old target.
  it('does not write a confirmed dialog whose drag was stood down', async () => {
    const commit = vi.fn(async () => {});
    const get = requirements([APPROVED_DATE]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    let caught: unknown;
    await act(async () => {
      void result.current.requestStateChange(7, 'Active', 'Contoso Ltd').catch((error) => {
        caught = error;
      });
    });
    expect(result.current.pending?.itemId).toBe(7);
    act(() => result.current.supersede(7));
    await act(async () => {
      await result.current.submit({ 'Custom.ApprovedDate': '2026-11-18' });
    });

    expect(commit).not.toHaveBeenCalled();
    expect(isStateChangeSuperseded(caught)).toBe(true);
    expect(result.current.pending).toBeNull();
  });

  // A card that came with no project still gets the dialog when DevOps
  // names the fields, using the project the server found the item in.
  it('opens the dialog for a card with no project, with the project the server found', async () => {
    const commit = vi
      .fn()
      .mockRejectedValueOnce(
        new MissingFieldsError('TF401320: Rule Error', [APPROVED_DATE], 'Contoso Ltd')
      )
      .mockResolvedValueOnce(undefined);
    const get = requirements([]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    let caught: unknown;
    await act(async () => {
      void result.current.requestStateChange(7, 'Active').catch((error) => {
        caught = error;
      });
    });

    expect(get).not.toHaveBeenCalled();
    expect(caught).toBeUndefined();
    expect(result.current.pending).toEqual({
      itemId: 7,
      state: 'Active',
      project: 'Contoso Ltd',
      fields: [APPROVED_DATE],
    });
  });

  it('hands the refusal back when there is no project to ask with', async () => {
    const refusal = new MissingFieldsError('TF401320: Rule Error', [APPROVED_DATE]);
    const commit = vi.fn().mockRejectedValueOnce(refusal);
    const get = requirements([]);
    const { result } = renderHook(() => useBoardStateChange({ get, commit }));

    let caught: unknown;
    await act(async () => {
      await result.current.requestStateChange(7, 'Active').catch((error) => {
        caught = error;
      });
    });

    expect(caught).toBe(refusal);
    expect(result.current.pending).toBeNull();
  });
});
