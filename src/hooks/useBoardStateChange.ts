'use client';

import { useCallback, useRef, useState } from 'react';
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

interface Options {
  get: BoardGet;
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

export function useBoardStateChange({ get, commit }: Options): BoardStateChange {
  const [pending, setPending] = useState<PendingBoardStateChange | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Settles the promise the board is awaiting while the dialog is open. */
  const settleRef = useRef<{ resolve: () => void; reject: (error: unknown) => void } | null>(null);

  const requestStateChange = useCallback(
    async (itemId: number, state: string, project?: string) => {
      // No project means nothing to ask: the rules live on the project's
      // process. Go through and let the server's own error speak (#651).
      if (!project) {
        await commit(itemId, state, undefined);
        return;
      }

      // `fetchStateRequirements` fails open, so a rules lookup that breaks
      // leaves the drag working exactly as it did before this hook existed.
      const fields = await fetchStateRequirements(get, itemId, project, state);
      if (fields.length === 0) {
        await commit(itemId, state, project);
        return;
      }

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
        setIsSubmitting(false);
        setPending(null);
      }
    },
    [commit, pending]
  );

  const cancel = useCallback(() => {
    settleRef.current?.reject(new StateChangeCancelled());
    settleRef.current = null;
    setPending(null);
  }, []);

  return { pending, isSubmitting, requestStateChange, submit, cancel };
}
