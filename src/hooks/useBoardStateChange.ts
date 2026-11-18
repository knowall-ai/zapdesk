'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchStateRequirements, type RequiredField } from '@/hooks/useWorkItemActions';
import { StateChangeCancelled } from '@/lib/state-change-cancelled';
import { missingFieldsOf } from '@/lib/missing-fields-error';

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
  /**
   * The card was dropped back where it started. Any drag of it still waiting
   * on its lookup stands down, so it cannot write a state the last drop
   * undid (#663 review).
   */
  supersede: (itemId: number) => void;
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
  /**
   * The latest drag of each work item, numbered.
   *
   * A card stays draggable while its rules lookup is away, so it can be
   * dragged again before the first lookup answers. Were the first to answer
   * last, its older state would be written last and kept, with nothing said
   * (#663 review). Only the newest drag of an item may go on to write.
   */
  const latestAttemptRef = useRef(new Map<number, number>());
  /**
   * The write in flight for each work item. A later write of the same item
   * waits for it: two PATCHes of one item racing could land in either order,
   * and the one the user made first would then be the one kept (#663 review).
   * Writes for different items do not wait on each other.
   */
  const writesRef = useRef(new Map<number, Promise<unknown>>());
  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  /**
   * False once the hook unmounts.
   *
   * The unmount cleanup calls `cancel`, but while the lookup is still running
   * there is nothing yet for it to cancel -- `settleRef` is only set when the
   * dialog opens. Without this, a lookup that answered after the page had gone
   * would open a dialog nobody can see, and leave the drag's promise and its
   * handler waiting for a submit that can never come (#663 review).
   */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const commitInTurn = useCallback(
    (
      itemId: number,
      state: string,
      project: string | undefined,
      additionalFields?: Record<string, string>
    ): Promise<void> => {
      const previous = writesRef.current.get(itemId) ?? Promise.resolve();
      const write = previous
        .catch(() => {
          // The earlier write's failure is its own caller's to report.
        })
        .then(() =>
          additionalFields === undefined
            ? commit(itemId, state, project)
            : commit(itemId, state, project, additionalFields)
        );
      writesRef.current.set(itemId, write);
      const forget = () => {
        if (writesRef.current.get(itemId) === write) writesRef.current.delete(itemId);
      };
      write.then(forget, forget);
      return write;
    },
    [commit]
  );

  /** Open the dialog and wait for it to be submitted or cancelled. */
  const askFor = useCallback(
    (itemId: number, state: string, project: string, fields: RequiredField[]) => {
      // One dialog at a time. A second drag landing while one is open would
      // replace the pending change, leaving the first drag's promise unsettled
      // for ever and its card parked in a column DevOps never accepted.
      if (settleRef.current) return Promise.reject(new StateChangeCancelled());
      return new Promise<void>((resolve, reject) => {
        settleRef.current = { resolve, reject };
        setPending({ itemId, state, project, fields });
      });
    },
    []
  );

  const requestStateChange = useCallback(
    async (itemId: number, state: string, project?: string) => {
      // No project means nothing to ask: the rules live on the project's
      // process. Go through and let the server's own error speak (#651).
      if (!project) {
        await commitInTurn(itemId, state, undefined);
        return;
      }

      // `fetchStateRequirements` fails open, so a rules lookup that breaks --
      // or times out -- leaves the drag working exactly as it did before this
      // hook existed.
      const askedIn = scopeRef.current;
      const attempt = (latestAttemptRef.current.get(itemId) ?? 0) + 1;
      latestAttemptRef.current.set(itemId, attempt);
      const fields = await fetchStateRequirements(
        (url) => get(url, { signal: AbortSignal.timeout(REQUIREMENTS_TIMEOUT_MS) }),
        itemId,
        project,
        state
      );
      // Checked before the commit below, not after it: a transition that
      // needs no fields was otherwise written with the drag's own closure, so
      // a switch during the lookup sent the PATCH to the organisation the drag
      // began in and popped its success toast over the new one (#663 review).
      //
      // The page stays usable during the lookup, so the organisation can have
      // changed by now, or the page can have gone entirely. Both take the
      // cancel path: doing nothing beats writing this item's answers to
      // whatever that id names elsewhere.
      if (scopeRef.current !== askedIn || !mountedRef.current) {
        throw new StateChangeCancelled();
      }
      // A newer drag of this item began during the lookup. That one is the
      // move the user means, so this one stands down without writing.
      if (latestAttemptRef.current.get(itemId) !== attempt) {
        throw new StateChangeCancelled({ superseded: true });
      }

      if (fields.length > 0) {
        await askFor(itemId, state, project, fields);
        return;
      }

      try {
        await commitInTurn(itemId, state, project);
      } catch (error) {
        // The lookup found nothing -- or could not look -- and DevOps then
        // refused the move for fields it wanted filled in, naming them. Ask
        // for those rather than show the rule error: this is how a user who
        // may not read process rules still gets the dialog (#663).
        const missing = missingFieldsOf(error);
        if (!missing) throw error;
        if (scopeRef.current !== askedIn || !mountedRef.current) {
          throw new StateChangeCancelled();
        }
        if (latestAttemptRef.current.get(itemId) !== attempt) {
          throw new StateChangeCancelled({ superseded: true });
        }
        await askFor(itemId, state, project, missing);
      }
    },
    [get, commitInTurn, askFor]
  );

  const submit = useCallback(
    async (values: Record<string, string>) => {
      const settle = settleRef.current;
      if (!pending || !settle) return;
      submittingRef.current = true;
      setIsSubmitting(true);
      let keepOpen = false;
      try {
        await commitInTurn(pending.itemId, pending.state, pending.project, values);
        settle.resolve();
      } catch (error) {
        // DevOps wants a field the dialog did not ask for -- the rule lookup
        // can miss one, and a refusal names them all. Add it and keep the
        // dialog open with what was already entered, rather than throw the
        // answers away for a rule error (#663).
        const missing = missingFieldsOf(error);
        const known = new Set(pending.fields.map((field) => field.referenceName));
        const extra = (missing ?? []).filter((field) => !known.has(field.referenceName));
        if (extra.length > 0) {
          keepOpen = true;
          setPending({ ...pending, fields: [...pending.fields, ...extra] });
        } else {
          // Handed to the board, which rolls the card back and shows the
          // message -- the same path as a drop DevOps refuses outright.
          settle.reject(error);
        }
      } finally {
        if (!keepOpen) {
          settleRef.current = null;
          setPending(null);
        }
        submittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [commitInTurn, pending]
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

  // A pending change belongs to the organisation it was asked in. The dialog
  // keeps focus inside itself, but the organisation can still change from
  // outside it -- another tab, a session refresh. Dropping the change is the
  // safe answer: the card goes back and nothing is written anywhere.
  useEffect(() => {
    return () => cancel();
  }, [scope, cancel]);

  const supersede = useCallback((itemId: number) => {
    if (!latestAttemptRef.current.has(itemId)) return;
    latestAttemptRef.current.set(itemId, (latestAttemptRef.current.get(itemId) ?? 0) + 1);
  }, []);

  return { pending, isSubmitting, requestStateChange, submit, cancel, supersede };
}
