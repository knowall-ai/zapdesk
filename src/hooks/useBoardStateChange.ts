'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchStateRequirements, type RequiredField } from '@/hooks/useWorkItemActions';
import { StateChangeCancelled } from '@/lib/state-change-cancelled';

/**
 * Asking the process for a transition's required fields from a board, and
 * holding the drag open while the user fills them in (#662).
 *
 * The detail page and the pop-up have done this since #651: pick a state, and
 * if the process demands Approved By and an Approved Date you are asked for
 * them. A board did not. It PATCHed straight through, DevOps refused the
 * transition, and the card sprang back wearing the rule's own error -- so the
 * one place people actually move work was the one place that could not.
 *
 * `requestStateChange` keeps the shape a board already expects: a promise that
 * resolves when the state is written and rejects when it is not, so the
 * existing optimistic move and its rollback carry on working untouched. The
 * promise simply stays pending while the dialog is open.
 */

export interface PendingBoardStateChange {
  itemId: number;
  /** The state being moved to, which is what the dialog is titled with. */
  state: string;
  project: string;
  fields: RequiredField[];
}

/**
 * A GET that takes only a signal.
 *
 * Narrow on purpose: the app's `devOpsGet` takes its own `FetchOptions`, whose
 * `headers` is a plain record rather than `HeadersInit`, so typing this as
 * `RequestInit` makes the real function unassignable. A timeout signal is all
 * either caller needs.
 */
export type BoardGet = (url: string, options?: { signal?: AbortSignal }) => Promise<Response>;

/**
 * How long the rules lookup may take before the drag goes through anyway.
 *
 * Nothing else bounded it: `devOpsGet` forwards only the caller's options to
 * `fetch`, so a stalled request left the drag unresolved with no dialog on
 * screen to cancel. An abort reaches the same fail-open path as any other
 * error, so a timed-out lookup still lets the move be attempted (#663 review).
 */
const REQUIREMENTS_TIMEOUT_MS = 10_000;

interface Options {
  get: BoardGet;
  /**
   * The organisation everything here belongs to, if the page has one.
   *
   * A pending change is only valid in the organisation it was asked in. The
   * work item id travels in the URL and the organisation in a header, so the
   * same id in another organisation is a different item -- and `commit` always
   * reads the newest organisation. Without this, switching organisations
   * during the lookup, or while the dialog is open, could write the answers to
   * whatever that id happens to name over there (#663 review).
   */
  scope?: string;
  /**
   * Writes the state. Must throw when the write fails, so the board rolls the
   * card back and shows the reason, as it does for a drop DevOps refuses.
   */
  commit: (
    itemId: number,
    state: string,
    project: string | undefined,
    additionalFields?: Record<string, string>
  ) => Promise<void>;
}

export interface BoardStateChange {
  pending: PendingBoardStateChange | null;
  isSubmitting: boolean;
  requestStateChange: (itemId: number, state: string, project?: string) => Promise<void>;
  submit: (values: Record<string, string>) => Promise<void>;
  cancel: () => void;
}

export function useBoardStateChange({ get, commit, scope }: Options): BoardStateChange {
  const [pending, setPending] = useState<PendingBoardStateChange | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Settles the promise the board is awaiting while the dialog is open. */
  const settleRef = useRef<{ resolve: () => void; reject: (error: unknown) => void } | null>(null);

  /**
   * Read through refs, not captured.
   *
   * `requestStateChange` and `cancel` have to keep their identity: a board
   * holds one across a drag, and the pages pass `cancel` where a changing
   * function would re-run work. Reading these two through refs keeps both
   * callbacks dependency-free, which also avoids a trap -- putting
   * `isSubmitting` in `cancel`'s dependencies would give `cancel` a new
   * identity on every submit, and the effect below, keyed on it, would then
   * cancel the very change being submitted.
   */
  const scopeRef = useRef(scope);
  const submittingRef = useRef(false);
  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  const requestStateChange = useCallback(
    async (itemId: number, state: string, project?: string) => {
      // No project means nothing to ask: the rules live on the project's
      // process. Go through and let the server's own error speak (#651).
      if (!project) {
        await commit(itemId, state, undefined);
        return;
      }

      // `fetchStateRequirements` fails open, so a rules lookup that breaks --
      // or times out -- leaves the drag working exactly as it did before this
      // hook existed.
      const askedIn = scopeRef.current;
      const fields = await fetchStateRequirements(
        (url) => get(url, { signal: AbortSignal.timeout(REQUIREMENTS_TIMEOUT_MS) }),
        itemId,
        project,
        state
      );
      if (fields.length === 0) {
        await commit(itemId, state, project);
        return;
      }

      // The page stays usable during the lookup, so the organisation can have
      // changed by now. Asking for this item's fields and writing them to
      // whatever that id names in another organisation would be worse than
      // doing nothing, so this takes the cancel path (#663 review).
      if (scopeRef.current !== askedIn) throw new StateChangeCancelled();

      // One dialog at a time. A second drag landing while one is open would
      // replace the pending change, leaving the first drag's promise unsettled
      // for ever and its card parked in a column DevOps never accepted.
      if (settleRef.current) throw new StateChangeCancelled();

      await new Promise<void>((resolve, reject) => {
        settleRef.current = { resolve, reject };
        setPending({ itemId, state, project, fields });
      });
    },
    [get, commit]
  );

  const submit = useCallback(
    async (values: Record<string, string>) => {
      const settle = settleRef.current;
      if (!pending || !settle) return;
      submittingRef.current = true;
      setIsSubmitting(true);
      try {
        await commit(pending.itemId, pending.state, pending.project, values);
        settle.resolve();
      } catch (error) {
        // Handed to the board, which rolls the card back and shows the
        // message -- the same path as a drop DevOps refuses outright.
        settle.reject(error);
      } finally {
        settleRef.current = null;
        submittingRef.current = false;
        setIsSubmitting(false);
        setPending(null);
      }
    },
    [commit, pending]
  );

  /**
   * Give up on the pending change, unless the write is already away.
   *
   * Cancelling mid-write would reject the promise the board is waiting on, so
   * the card would go back to its old column -- while the PATCH carried on and
   * very likely succeeded. The board would then show one state and the server
   * hold another (#663 review). The dialog's own controls go quiet while a
   * write is in flight; this is the guarantee behind them.
   */
  const cancel = useCallback(() => {
    if (submittingRef.current) return;
    settleRef.current?.reject(new StateChangeCancelled());
    settleRef.current = null;
    setPending(null);
  }, []);

  // A pending change belongs to the organisation it was asked in, and the
  // dialog has no focus trap, so a keyboard user can still reach the
  // organisation switcher behind it. Dropping the change is the safe answer:
  // the card goes back and nothing is written anywhere.
  useEffect(() => {
    return () => cancel();
  }, [scope, cancel]);

  return { pending, isSubmitting, requestStateChange, submit, cancel };
}
